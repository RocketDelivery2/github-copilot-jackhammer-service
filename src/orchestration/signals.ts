import type {
  ConversationKind,
  ExecutionEvent,
  QueueSignal,
  WorkItem,
  WorkItemPriority,
} from './types.js';

export type ExecutionOutput = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  workItemId?: string;
};

const BUILD_FAILURE_PATTERNS: RegExp[] = [
  /error TS\d+/i,
  /\btsc\b[\s\S]*(?:error|failed)/i,
  /failed to compile/i,
  /\bbuild (?:failed|error)/i,
  /compilation failed/i,
  /cannot find module/i,
  /module not found/i,
  /\b(?:vite|webpack|rollup)\b[\s\S]*(?:failed|error)/i,
];

const TEST_FAILURE_PATTERNS: RegExp[] = [
  /\btests?\s+failed\b/i,
  /\bfailing tests?\b/i,
  /test suites?\s+failed/i,
  /\bfailed tests?\b/i,
  /assertionerror/i,
  /expected[\s\S]+(?:received|actual)/i,
  /\b(?:jest|vitest|mocha|pytest|ava)\b[\s\S]*\bfail/i,
];

const LINT_FAILURE_PATTERNS: RegExp[] = [
  /\beslint\b[\s\S]*(?:error|problem|failed)/i,
  /\blint (?:failed|error|errors|problems)/i,
  /\bprettier\b[\s\S]*(?:failed|error|check)/i,
  /\b(?:ruff|flake8|stylelint)\b[\s\S]*(?:failed|error)/i,
];

const AGENT_QUESTION_PATTERNS: RegExp[] = [
  /which direction would you like to go/i,
  /could you clarify/i,
  /can you clarify/i,
  /please clarify/i,
  /would you like me to/i,
  /should i proceed/i,
  /do you want me to/i,
  /let me know (?:which|how|what|if)/i,
  /please (?:choose|select|confirm|specify)/i,
  /\?\s*$/,
];

const MISSING_TESTS_PATTERNS: RegExp[] = [
  /no tests found/i,
  /missing tests?/i,
  /without tests?/i,
  /add tests? before/i,
  /coverage[\s\S]*(?:below|missing|low)/i,
  /test coverage[\s\S]*(?:missing|low)/i,
];

const NEEDS_RESEARCH_PATTERNS: RegExp[] = [
  /needs? research/i,
  /requires research/i,
  /look up/i,
  /search docs/i,
  /read the docs/i,
  /documentation unclear/i,
  /unknown api/i,
  /current behavior unknown/i,
  /web search/i,
];

const NEEDS_ARCHITECT_DECISION_PATTERNS: RegExp[] = [
  /architect(?:ure)? decision/i,
  /needs? architectural? decision/i,
  /design decision/i,
  /choose an approach/i,
  /which approach/i,
  /trade-?off/i,
  /product decision/i,
  /requires decision/i,
  /needs? maintainer input/i,
];

export function classifyExecutionSignals(output: ExecutionOutput): QueueSignal[] {
  const combined = [output.stdout, output.stderr].filter(Boolean).join('\n');
  const hasNonZeroExit = typeof output.exitCode === 'number' && output.exitCode !== 0;
  const signals: QueueSignal[] = [];

  addIfMatching(signals, {
    kind: 'build_failure',
    severity: 'error',
    message: 'Build failure detected.',
    workItemId: output.workItemId,
    evidence: combined,
  }, combined, BUILD_FAILURE_PATTERNS, hasNonZeroExit && /\b(?:build|tsc|compile|vite|webpack|rollup)\b/i.test(combined));

  addIfMatching(signals, {
    kind: 'test_failure',
    severity: 'error',
    message: 'Test failure detected.',
    workItemId: output.workItemId,
    evidence: combined,
  }, combined, TEST_FAILURE_PATTERNS, hasNonZeroExit && /\b(?:test|jest|vitest|mocha|pytest|ava)\b/i.test(combined));

  addIfMatching(signals, {
    kind: 'lint_failure',
    severity: 'error',
    message: 'Lint failure detected.',
    workItemId: output.workItemId,
    evidence: combined,
  }, combined, LINT_FAILURE_PATTERNS, hasNonZeroExit && /\b(?:lint|eslint|prettier|ruff|flake8|stylelint)\b/i.test(combined));

  addIfMatching(signals, {
    kind: 'agent_question',
    severity: 'warning',
    message: 'Agent question detected.',
    workItemId: output.workItemId,
    evidence: combined,
  }, combined, AGENT_QUESTION_PATTERNS);

  addIfMatching(signals, {
    kind: 'missing_tests',
    severity: 'warning',
    message: 'Missing or insufficient tests detected.',
    workItemId: output.workItemId,
    evidence: combined,
  }, combined, MISSING_TESTS_PATTERNS);

  addIfMatching(signals, {
    kind: 'needs_research',
    severity: 'info',
    message: 'Research need detected.',
    workItemId: output.workItemId,
    evidence: combined,
  }, combined, NEEDS_RESEARCH_PATTERNS);

  addIfMatching(signals, {
    kind: 'needs_architect_decision',
    severity: 'warning',
    message: 'Architectural decision need detected.',
    workItemId: output.workItemId,
    evidence: combined,
  }, combined, NEEDS_ARCHITECT_DECISION_PATTERNS);

  return signals;
}

export function classifyExecutionEvent(event: ExecutionEvent): QueueSignal[] {
  return classifyExecutionSignals({
    stdout: event.stdout,
    stderr: event.stderr ?? event.message,
    exitCode: event.exitCode,
    workItemId: event.workItemId,
  });
}

export function classifyExecutionEvents(events: readonly ExecutionEvent[]): QueueSignal[] {
  const signals: QueueSignal[] = [];
  for (const event of events) {
    for (const signal of classifyExecutionEvent(event)) {
      pushUniqueSignal(signals, signal);
    }
  }
  return signals;
}

export function conversationKindForSignal(signal: QueueSignal): ConversationKind | null {
  if (signal.kind === 'agent_question') return 'agent_question';
  if (signal.kind === 'missing_tests') return 'missing_tests';
  if (signal.kind === 'needs_research') return 'needs_research';
  if (signal.kind === 'needs_architect_decision') return 'needs_architect_decision';
  if (signal.kind === 'blocker') return 'blocked';
  return null;
}

export function createConversationWorkItem(signal: QueueSignal): WorkItem | null {
  const conversationKind = conversationKindForSignal(signal);
  if (!conversationKind) return null;

  return {
    id: `conversation:${signal.kind}:${signal.workItemId ?? signal.targetItemId ?? 'global'}`,
    title: conversationTitle(conversationKind),
    kind: 'conversation',
    status: 'pending',
    priority: conversationPriority(conversationKind),
    description: signal.message,
    writePaths: [],
  };
}

function addIfMatching(
  signals: QueueSignal[],
  signal: QueueSignal,
  text: string,
  patterns: readonly RegExp[],
  forcedMatch = false,
): void {
  if (!text && !forcedMatch) return;
  if (!forcedMatch && !patterns.some(pattern => pattern.test(text))) return;

  pushUniqueSignal(signals, {
    ...signal,
    evidence: signal.evidence ? trimEvidence(signal.evidence) : undefined,
  });
}

function pushUniqueSignal(signals: QueueSignal[], signal: QueueSignal): void {
  const exists = signals.some(existing =>
    existing.kind === signal.kind
    && existing.workItemId === signal.workItemId
    && existing.targetItemId === signal.targetItemId
  );

  if (!exists) signals.push(signal);
}

function trimEvidence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}

function conversationTitle(kind: ConversationKind): string {
  if (kind === 'agent_question') return 'Resolve agent question';
  if (kind === 'missing_tests') return 'Clarify missing test coverage';
  if (kind === 'needs_research') return 'Resolve research question';
  if (kind === 'needs_architect_decision') return 'Request architecture decision';
  return 'Resolve blocker';
}

function conversationPriority(kind: ConversationKind): WorkItemPriority {
  if (kind === 'agent_question' || kind === 'needs_architect_decision') return 'urgent';
  if (kind === 'missing_tests' || kind === 'blocked') return 'high';
  return 'medium';
}
