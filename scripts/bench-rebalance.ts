import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { classifyExecutionEvents, createConversationWorkItem } from '../src/orchestration/signals.js';
import { rebalanceWorkItems } from '../src/orchestration/rebalance.js';
import type { ExecutionEvent, QueueSignal, QueueSignalKind, WorkItem } from '../src/orchestration/types.js';

const ITERATIONS = 50;
const FAILURE_SIGNAL_KINDS = new Set<QueueSignalKind>([
  'build_failure',
  'test_failure',
  'lint_failure',
]);

const fixture = buildFixture();
const legacyResult = legacyRebalanceWorkItems(fixture.workItems, fixture.events, fixture.signals);
const optimizedResult = rebalanceWorkItems(fixture.workItems, fixture.events, fixture.signals);

assert.deepEqual(optimizedResult, legacyResult);

const legacyTiming = time(() => legacyRebalanceWorkItems(fixture.workItems, fixture.events, fixture.signals));
const optimizedTiming = time(() => rebalanceWorkItems(fixture.workItems, fixture.events, fixture.signals));

console.log(`rebalance benchmark (${fixture.workItems.length} items, ${fixture.signals.length} signals, ${fixture.events.length} events, ${ITERATIONS} iterations)`);
console.log(formatTiming('legacy', legacyTiming, ITERATIONS));
console.log(formatTiming('optimized', optimizedTiming, ITERATIONS));
console.log(`speedup: ${(legacyTiming / optimizedTiming).toFixed(2)}x`);

function legacyRebalanceWorkItems(
  workItems: readonly WorkItem[],
  events: readonly ExecutionEvent[] = [],
  signals: readonly QueueSignal[] = [],
): WorkItem[] {
  const allSignals = legacyMergeSignals([...signals, ...classifyExecutionEvents(events)]);
  const items = workItems.map(cloneWorkItem);

  legacyPromoteOrInsertFailureFix(items, allSignals);
  legacyInsertConversationItems(items, allSignals);

  const completedIds = new Set(items.filter(item => item.status === 'completed').map(item => item.id));
  const context = {
    signals: allSignals,
    completedIds,
    hasActiveFailure: allSignals.some(signal => FAILURE_SIGNAL_KINDS.has(signal.kind)),
  };
  const originalOrder = new Map(items.map((item, index) => [item.id, index]));

  return [...items].sort((a, b) => {
    const scoreDiff = legacyScoreWorkItem(b, context) - legacyScoreWorkItem(a, context);
    if (scoreDiff !== 0) return scoreDiff;
    return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
  });
}

function legacyScoreWorkItem(
  item: WorkItem,
  context: {
    signals: readonly QueueSignal[];
    completedIds: ReadonlySet<string>;
    hasActiveFailure: boolean;
  },
): number {
  let score = 0;

  if (item.status === 'pending') score += 100;
  if (item.status === 'running') score += 80;
  if (item.status === 'failed') score -= 200;
  if (item.status === 'blocked') score -= 2000;
  if (item.status === 'completed' || item.status === 'skipped') score -= 10000;

  if (item.priority === 'urgent') score += 1000;
  if (item.priority === 'high') score += 300;
  if (item.priority === 'medium') score += 100;

  if (item.kind === 'fix') score += 600;
  if (item.kind === 'conversation') score += 450;
  if (item.kind === 'research') score += 250;
  if (item.kind === 'validation') score += 200;
  if (item.kind === 'agent_command') score += 150;
  if (item.kind === 'shell_command') score += 50;

  if (context.hasActiveFailure && isFeatureOrRefactorWork(item)) score -= 150;
  if (!dependenciesComplete(item, context.completedIds)) score -= 500;

  for (const signal of context.signals) {
    const targetId = signal.targetItemId ?? signal.workItemId;
    if (signal.kind === 'urgent' && targetId === item.id) score += 1200;
    if (signal.kind === 'blocker' && targetId === item.id) score -= 2500;
    if (FAILURE_SIGNAL_KINDS.has(signal.kind) && item.id === failureFixId(signal)) score += 2000;
  }

  return score;
}

function legacyPromoteOrInsertFailureFix(items: WorkItem[], signals: readonly QueueSignal[]): void {
  const failure = signals.find(signal => FAILURE_SIGNAL_KINDS.has(signal.kind));
  if (!failure) return;

  const fixId = failureFixId(failure);
  const existingIndex = items.findIndex(item =>
    item.id === fixId
    || (item.kind === 'fix' && itemMatchesFailure(item, failure.kind))
  );

  if (existingIndex >= 0) {
    const existing = items[existingIndex]!;
    items[existingIndex] = {
      ...existing,
      priority: 'urgent',
      status: existing.status === 'blocked' ? 'pending' : existing.status,
    };
    return;
  }

  items.push({
    id: fixId,
    title: `Fix ${failure.kind.replace('_', ' ')}`,
    kind: 'fix',
    status: 'pending',
    priority: 'urgent',
    description: failure.message,
    writePaths: [],
  });
}

function legacyInsertConversationItems(items: WorkItem[], signals: readonly QueueSignal[]): void {
  for (const signal of signals) {
    const conversation = createConversationWorkItem(signal);
    if (!conversation) continue;
    if (items.some(item => item.id === conversation.id)) continue;
    items.push(conversation);
  }
}

function legacyMergeSignals(signals: QueueSignal[]): QueueSignal[] {
  const merged: QueueSignal[] = [];

  for (const signal of signals) {
    const exists = merged.some(existing =>
      existing.kind === signal.kind
      && existing.workItemId === signal.workItemId
      && existing.targetItemId === signal.targetItemId
    );
    if (!exists) merged.push(signal);
  }

  return merged;
}

function buildFixture(): {
  workItems: WorkItem[];
  events: ExecutionEvent[];
  signals: QueueSignal[];
} {
  const workItems: WorkItem[] = [];
  const signals: QueueSignal[] = [];
  const events: ExecutionEvent[] = [];

  for (let index = 0; index < 200; index += 1) {
    workItems.push({
      id: `item-${index}`,
      title: `Work item ${index}`,
      kind: index % 11 === 0 ? 'feature' : index % 11 === 1 ? 'refactor' : index % 11 === 2 ? 'validation' : 'maintenance',
      status: index % 9 === 0 ? 'completed' : index % 7 === 0 ? 'running' : 'pending',
      priority: index % 5 === 0 ? 'urgent' : index % 5 === 1 ? 'high' : 'medium',
      dependsOn: index > 0 && index % 4 === 0 ? [`item-${index - 1}`, `item-${index - 2}`] : undefined,
      writePaths: index % 3 === 0 ? ['src/orchestration'] : ['src/orchestration/rebalance.ts'],
      worktree: index % 2 === 0 ? '.work/a' : '.work/b',
    });
  }

  for (let index = 0; index < 30; index += 1) {
    const targetId = `item-${index * 3}`;
    signals.push({
      kind: index % 3 === 0 ? 'urgent' : index % 3 === 1 ? 'blocker' : 'missing_tests',
      severity: index % 3 === 0 ? 'warning' : index % 3 === 1 ? 'warning' : 'warning',
      message: `Signal ${index}`,
      targetItemId: index % 3 === 2 ? undefined : targetId,
      workItemId: index % 3 === 2 ? targetId : undefined,
    });
  }

  for (let index = 0; index < 30; index += 1) {
    events.push({
      workItemId: `item-${index * 2}`,
      kind: index % 2 === 0 ? 'stderr' : 'stdout',
      stderr: index % 4 === 0 ? 'No tests found for this change.' : 'ESLint found 1 error.',
      stdout: index % 4 === 1 ? 'Build failed.' : 'Copilot asked which approach to use?',
      exitCode: index % 4 === 0 ? 1 : 0,
    });
  }

  return { workItems, events, signals };
}

function time(fn: () => WorkItem[]): number {
  for (let i = 0; i < 10; i += 1) fn();

  const startedAt = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) fn();
  return performance.now() - startedAt;
}

function formatTiming(label: string, totalMs: number, iterations: number): string {
  return `${label}: ${totalMs.toFixed(1)} ms total (${(totalMs / iterations).toFixed(2)} ms/op)`;
}

function failureFixId(signal: QueueSignal): string {
  return `fix:${signal.kind}:${signal.workItemId ?? signal.targetItemId ?? 'global'}`;
}

function itemMatchesFailure(item: WorkItem, kind: QueueSignalKind): boolean {
  const text = `${item.title} ${item.description ?? ''}`.toLowerCase();
  if (kind === 'build_failure') return text.includes('build');
  if (kind === 'test_failure') return text.includes('test');
  if (kind === 'lint_failure') return text.includes('lint');
  return false;
}

function isFeatureOrRefactorWork(item: WorkItem): boolean {
  return item.kind === 'feature'
    || item.kind === 'refactor'
    || item.kind === 'docs'
    || item.kind === 'maintenance';
}

function dependenciesComplete(item: WorkItem, completedIds: ReadonlySet<string>): boolean {
  return (item.dependsOn ?? []).every(id => completedIds.has(id));
}

function cloneWorkItem(item: WorkItem): WorkItem {
  return {
    ...item,
    dependsOn: item.dependsOn ? [...item.dependsOn] : undefined,
    readPaths: item.readPaths ? [...item.readPaths] : undefined,
    writePaths: item.writePaths ? [...item.writePaths] : undefined,
  };
}
