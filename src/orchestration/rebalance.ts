/**
 * Rebalances a work-item queue by inserting fix and conversation work ahead of
 * feature/refactor items whenever failure or ambiguity signals are present.
 * Pure function: produces a new sorted array without mutating the inputs.
 */
import { classifyExecutionEvents, createConversationWorkItem } from './signals.js';
import type { ExecutionEvent, QueueSignal, QueueSignalKind, WorkItem } from './types.js';

type ScoreContext = {
  signals: readonly QueueSignal[];
  completedIds: ReadonlySet<string>;
  hasActiveFailure: boolean;
};

const FAILURE_SIGNAL_KINDS = new Set<QueueSignalKind>([
  'build_failure',
  'test_failure',
  'lint_failure',
]);

export function rebalanceWorkItems(
  workItems: readonly WorkItem[],
  events: readonly ExecutionEvent[] = [],
  signals: readonly QueueSignal[] = [],
): WorkItem[] {
  const allSignals = mergeSignals([...signals, ...classifyExecutionEvents(events)]);
  const items = workItems.map(cloneWorkItem);

  promoteOrInsertFailureFix(items, allSignals);
  insertConversationItems(items, allSignals);

  const completedIds = new Set(items.filter(item => item.status === 'completed').map(item => item.id));
  const context: ScoreContext = {
    signals: allSignals,
    completedIds,
    hasActiveFailure: allSignals.some(signal => FAILURE_SIGNAL_KINDS.has(signal.kind)),
  };
  const originalOrder = new Map(items.map((item, index) => [item.id, index]));

  return [...items].sort((a, b) => {
    const scoreDiff = scoreWorkItem(b, context) - scoreWorkItem(a, context);
    if (scoreDiff !== 0) return scoreDiff;
    return (originalOrder.get(a.id) ?? 0) - (originalOrder.get(b.id) ?? 0);
  });
}

export function scoreWorkItem(
  item: WorkItem,
  context: Partial<ScoreContext> = {},
): number {
  const signals = context.signals ?? [];
  const completedIds = context.completedIds ?? new Set<string>();
  const hasActiveFailure = context.hasActiveFailure ?? signals.some(signal => FAILURE_SIGNAL_KINDS.has(signal.kind));

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

  if (hasActiveFailure && isFeatureOrRefactorWork(item)) score -= 150;
  if (!dependenciesComplete(item, completedIds)) score -= 500;

  for (const signal of signals) {
    const targetId = signal.targetItemId ?? signal.workItemId;
    if (signal.kind === 'urgent' && targetId === item.id) score += 1200;
    if (signal.kind === 'blocker' && targetId === item.id) score -= 2500;
    if (FAILURE_SIGNAL_KINDS.has(signal.kind) && item.id === failureFixId(signal)) score += 2000;
  }

  return score;
}

function promoteOrInsertFailureFix(items: WorkItem[], signals: readonly QueueSignal[]): void {
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

function insertConversationItems(items: WorkItem[], signals: readonly QueueSignal[]): void {
  for (const signal of signals) {
    const conversation = createConversationWorkItem(signal);
    if (!conversation) continue;
    if (items.some(item => item.id === conversation.id)) continue;
    items.push(conversation);
  }
}

function failureFixId(signal: QueueSignal): string {
  return `fix:${signal.kind}:${signal.workItemId ?? signal.targetItemId ?? 'global'}`;
}

/** Maps each failure signal kind to the keyword searched in item title/description. */
const FAILURE_KEYWORD: Partial<Record<QueueSignalKind, string>> = {
  build_failure: 'build',
  test_failure: 'test',
  lint_failure: 'lint',
};

function itemMatchesFailure(item: WorkItem, kind: QueueSignalKind): boolean {
  const keyword = FAILURE_KEYWORD[kind];
  if (!keyword) return false;
  const text = `${item.title} ${item.description ?? ''}`.toLowerCase();
  return text.includes(keyword);
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

function mergeSignals(signals: QueueSignal[]): QueueSignal[] {
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
