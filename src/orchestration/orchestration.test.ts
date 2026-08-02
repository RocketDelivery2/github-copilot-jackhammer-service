import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractCommandCandidates } from './parser.js';
import { canRunInParallel, planRunnableBatch } from './parallelism.js';
import { rebalanceWorkItems } from './rebalance.js';
import { classifyExecutionEvents, classifyExecutionSignals } from './signals.js';
import type { ExecutionEvent, QueueSignal, WorkItem } from './types.js';

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: 'item',
    title: 'Item',
    kind: 'feature',
    status: 'pending',
    priority: 'medium',
    ...overrides,
  };
}

describe('orchestration parser', () => {
  it('extracts command candidates in markdown and code-block order', () => {
    const markdown = [
      '1. Run `npm test`',
      '```bash',
      'npm run build',
      'git status',
      '```',
      '- Ask Copilot to continue the implementation',
      '- Research current API docs',
    ].join('\n');

    const candidates = extractCommandCandidates(markdown);

    assert.deepEqual(candidates.map(candidate => candidate.text), [
      'npm test',
      'npm run build',
      'git status',
      'Ask Copilot to continue the implementation',
      'Research current API docs',
    ]);
    assert.deepEqual(candidates.map(candidate => candidate.kind), [
      'validation',
      'validation',
      'shell_command',
      'agent_command',
      'research',
    ]);
  });
});

describe('orchestration signals', () => {
  it('classifies execution output into failure signals', () => {
    const signals = classifyExecutionSignals({
      workItemId: 'validate',
      stderr: 'npm run lint\nESLint found 2 errors',
      exitCode: 1,
    });

    assert.equal(signals[0]?.kind, 'lint_failure');
    assert.equal(signals[0]?.workItemId, 'validate');
  });
});

describe('orchestration rebalance', () => {
  it('inserts fix-first work ahead of feature and refactor work after failures', () => {
    const queue = [
      item({ id: 'feature', title: 'Add feature', kind: 'feature' }),
      item({ id: 'refactor', title: 'Refactor module', kind: 'refactor' }),
    ];
    const signals: QueueSignal[] = [{
      kind: 'build_failure',
      severity: 'error',
      message: 'Build failed.',
      workItemId: 'validate',
    }];

    const rebalanced = rebalanceWorkItems(queue, [], signals);

    assert.equal(rebalanced[0]?.id, 'fix:build_failure:validate');
    assert.equal(rebalanced[0]?.kind, 'fix');
    assert.equal(rebalanced[1]?.id, 'feature');
  });

  it('promotes urgent targeted work', () => {
    const queue = [
      item({ id: 'feature', title: 'Add feature', priority: 'low' }),
      item({ id: 'hotfix', title: 'Patch production issue', priority: 'low' }),
    ];
    const signals: QueueSignal[] = [{
      kind: 'urgent',
      severity: 'warning',
      message: 'Handle this first.',
      targetItemId: 'hotfix',
    }];

    const rebalanced = rebalanceWorkItems(queue, [], signals);

    assert.equal(rebalanced[0]?.id, 'hotfix');
  });

  it('deprioritizes blocked work', () => {
    const queue = [
      item({ id: 'blocked', title: 'Deploy migration', priority: 'urgent' }),
      item({ id: 'next', title: 'Write tests', kind: 'validation', priority: 'medium' }),
    ];
    const signals: QueueSignal[] = [{
      kind: 'blocker',
      severity: 'warning',
      message: 'Migration window is not approved.',
      targetItemId: 'blocked',
    }];

    const rebalanced = rebalanceWorkItems(queue, [], signals);

    assert.equal(rebalanced[rebalanced.length - 1]?.id, 'blocked');
  });

  it('creates conversation work for agent questions', () => {
    const queue = [
      item({ id: 'feature', title: 'Continue feature', kind: 'feature' }),
    ];
    const signals: QueueSignal[] = [{
      kind: 'agent_question',
      severity: 'warning',
      message: 'Copilot asked which approach to use.',
      workItemId: 'feature',
    }];

    const rebalanced = rebalanceWorkItems(queue, [], signals);

    assert.equal(rebalanced[0]?.id, 'conversation:agent_question:feature');
    assert.equal(rebalanced[0]?.kind, 'conversation');
  });

  it('deduplicates equivalent signals before rebalance scoring', () => {
    const queue = [
      item({ id: 'feature', title: 'Continue feature', kind: 'feature' }),
    ];
    const explicitSignals: QueueSignal[] = [{
      kind: 'missing_tests',
      severity: 'warning',
      message: 'Missing tests were detected.',
      workItemId: 'feature',
    }];
    const events = [{
      workItemId: 'feature',
      kind: 'stderr' as const,
      stderr: 'No tests found for this change.',
    }];

    const rebalanced = rebalanceWorkItems(queue, events, explicitSignals);
    const conversationItems = rebalanced.filter(workItem => workItem.kind === 'conversation');

    assert.equal(conversationItems.length, 1);
    assert.equal(conversationItems[0]?.id, 'conversation:missing_tests:feature');
  });

  it('keeps the input queue detached from the rebalanced result', () => {
    const queue = [
      item({
        id: 'feature',
        title: 'Continue feature',
        kind: 'feature',
        readPaths: ['src/feature.ts'],
        writePaths: ['src/feature.ts'],
        dependsOn: ['base'],
      }),
      item({ id: 'base', title: 'Base task', status: 'completed' }),
    ];

    const rebalanced = rebalanceWorkItems(queue);

    if (rebalanced[0]) {
      rebalanced[0].title = 'Updated feature';
    }

    assert.notEqual(rebalanced[0], queue[0]);
    assert.equal(queue[0]?.title, 'Continue feature');
    assert.deepEqual(queue[0]?.readPaths, ['src/feature.ts']);
    assert.deepEqual(queue[0]?.writePaths, ['src/feature.ts']);
    assert.deepEqual(queue[0]?.dependsOn, ['base']);
  });
});

describe('orchestration parallelism', () => {
  it('rejects overlapping writes and shared worktrees', () => {
    const a = item({ id: 'a', writePaths: ['src/orchestration'], worktree: '.work/a' });
    const b = item({ id: 'b', writePaths: ['src/orchestration/parser.ts'], worktree: '.work/b' });
    const c = item({ id: 'c', writePaths: ['docs'], worktree: '.work/a' });
    const dependent = item({ id: 'dependent', dependsOn: ['base'], worktree: '.work/dependent' });
    const base = item({ id: 'base', worktree: '.work/base' });

    assert.equal(canRunInParallel(a, b).canRun, false);
    assert.equal(canRunInParallel(a, c).canRun, false);
    assert.equal(canRunInParallel(dependent, base).canRun, false);
  });

  it('plans only safe runnable batches', () => {
    const queue = [
      item({ id: 'setup', title: 'Install deps', kind: 'shell_command', command: 'npm ci', isBarrier: true }),
      item({ id: 'feature-a', writePaths: ['src/a.ts'], worktree: '.work/a' }),
      item({ id: 'feature-b', writePaths: ['src/b.ts'], worktree: '.work/b' }),
      item({ id: 'after-setup', dependsOn: ['setup'], worktree: '.work/c' }),
    ];

    assert.deepEqual(planRunnableBatch(queue, 3).map(workItem => workItem.id), ['setup']);

    const afterSetupQueue = queue.map(workItem =>
      workItem.id === 'setup' ? { ...workItem, status: 'completed' as const } : workItem
    );

    assert.deepEqual(planRunnableBatch(afterSetupQueue, 3).map(workItem => workItem.id), [
      'feature-a',
      'feature-b',
      'after-setup',
    ]);

    const runningBarrierQueue = [
      item({ id: 'install', status: 'running', command: 'npm ci', isBarrier: true }),
      item({ id: 'feature', writePaths: ['src/feature.ts'], worktree: '.work/feature' }),
    ];

    assert.deepEqual(planRunnableBatch(runningBarrierQueue, 2), []);
  });
});

describe('DS/Algo — mergeSignals deduplication (O(n) composite-key Set)', () => {
  it('duplicate signals produce only one fix item', () => {
    const queue = [item({ id: 'feat', title: 'Add feature', kind: 'feature' })];
    // Feed the same build_failure signal twice — should insert exactly one fix item.
    const signals: QueueSignal[] = [
      { kind: 'build_failure', severity: 'error', message: 'Build failed.', workItemId: 'validate' },
      { kind: 'build_failure', severity: 'error', message: 'Build failed again.', workItemId: 'validate' },
    ];

    const rebalanced = rebalanceWorkItems(queue, [], signals);
    const fixItems = rebalanced.filter(w => w.kind === 'fix');
    assert.equal(fixItems.length, 1, 'Duplicate signals must not produce multiple fix items');
  });

  it('urgent signals for distinct items are not conflated after merging', () => {
    // Two distinct urgent signals (different targetItemIds) — both should apply scoring.
    const queue = [
      item({ id: 'alpha', title: 'Alpha', kind: 'feature', priority: 'low' }),
      item({ id: 'beta',  title: 'Beta',  kind: 'feature', priority: 'low' }),
      item({ id: 'gamma', title: 'Gamma', kind: 'feature', priority: 'low' }),
    ];
    // Duplicate urgent signal for alpha (should merge to one), separate one for beta.
    const signals: QueueSignal[] = [
      { kind: 'urgent', severity: 'warning', message: 'Promote alpha.', targetItemId: 'alpha' },
      { kind: 'urgent', severity: 'warning', message: 'Promote alpha again.', targetItemId: 'alpha' },
      { kind: 'urgent', severity: 'warning', message: 'Promote beta.', targetItemId: 'beta' },
    ];

    const result = rebalanceWorkItems(queue, [], signals);
    // alpha and beta both get +1200 from urgent signals; gamma gets nothing.
    // Both alpha and beta should rank above gamma.
    const ids = result.map(w => w.id);
    assert.ok(ids.indexOf('gamma') > ids.indexOf('alpha'), 'alpha (urgent) must rank above gamma');
    assert.ok(ids.indexOf('gamma') > ids.indexOf('beta'),  'beta (urgent) must rank above gamma');
  });
});

describe('DS/Algo — sort stability (equal-score items keep original order)', () => {
  it('items with identical score keep their insertion order', () => {
    // Two features with the same priority and no signals — must come out in insertion order.
    const queue = [
      item({ id: 'alpha', title: 'Alpha', kind: 'feature', priority: 'medium' }),
      item({ id: 'beta',  title: 'Beta',  kind: 'feature', priority: 'medium' }),
      item({ id: 'gamma', title: 'Gamma', kind: 'feature', priority: 'medium' }),
    ];

    const result = rebalanceWorkItems(queue, [], []);
    assert.deepEqual(result.map(w => w.id), ['alpha', 'beta', 'gamma'],
      'Equal-score work items must maintain original relative order (stable sort)');
  });

  it('rebalanceWorkItems is deterministic across repeated calls', () => {
    const queue = [
      item({ id: 'a', kind: 'fix',      priority: 'urgent' }),
      item({ id: 'b', kind: 'feature',  priority: 'high'   }),
      item({ id: 'c', kind: 'refactor', priority: 'medium' }),
      item({ id: 'd', kind: 'docs',     priority: 'low'    }),
    ];

    const first  = rebalanceWorkItems([...queue], [], []).map(w => w.id);
    const second = rebalanceWorkItems([...queue], [], []).map(w => w.id);
    assert.deepEqual(first, second, 'rebalanceWorkItems must be deterministic across calls');
  });
});

describe('DS/Algo — classifyExecutionEvents dedup (O(n) Set-keyed)', () => {
  it('duplicate signals from multiple events appear only once', () => {
    // Two events both producing a build_failure for the same workItemId.
    const events: ExecutionEvent[] = [
      { workItemId: 'ci', kind: 'stderr', stderr: 'error TS2322: type mismatch', exitCode: 1 },
      { workItemId: 'ci', kind: 'stderr', stderr: 'error TS2345: argument error',  exitCode: 1 },
    ];

    const signals = classifyExecutionEvents(events);
    const buildFailures = signals.filter(s => s.kind === 'build_failure' && s.workItemId === 'ci');
    assert.equal(buildFailures.length, 1,
      'Multiple events with same failure kind + workItemId must yield exactly one signal');
  });

  it('same signal kind for different workItemIds appears once per workItemId', () => {
    const events: ExecutionEvent[] = [
      { workItemId: 'job-a', kind: 'stderr', stderr: 'error TS2322: type mismatch', exitCode: 1 },
      { workItemId: 'job-b', kind: 'stderr', stderr: 'error TS2345: argument error',  exitCode: 1 },
    ];

    const signals = classifyExecutionEvents(events);
    const buildFailures = signals.filter(s => s.kind === 'build_failure');
    assert.equal(buildFailures.length, 2, 'Different workItemIds must each emit their own signal');
    const ids = buildFailures.map(s => s.workItemId);
    assert.ok(ids.includes('job-a'));
    assert.ok(ids.includes('job-b'));
  });
});

describe('DS/Algo — insertConversationItems dedup (O(n+m) Set snapshot)', () => {
  it('repeated agent_question signals for the same workItemId produce one conversation item', () => {
    const queue = [item({ id: 'feature', title: 'Continue feature', kind: 'feature' })];
    const signals: QueueSignal[] = [
      { kind: 'agent_question', severity: 'warning', message: 'First question.', workItemId: 'feature' },
      { kind: 'agent_question', severity: 'warning', message: 'Second question.', workItemId: 'feature' },
    ];

    const result = rebalanceWorkItems(queue, [], signals);
    const convItems = result.filter(w => w.kind === 'conversation');
    assert.equal(convItems.length, 1,
      'Repeated agent_question signals for same workItemId must not create duplicate conversation items');
  });

  it('pre-existing conversation item in queue is not duplicated', () => {
    const conversationId = 'conversation:agent_question:feature';
    const queue = [
      item({ id: 'feature', title: 'Continue feature', kind: 'feature' }),
      item({ id: conversationId, title: 'Resolve agent question', kind: 'conversation', priority: 'urgent' }),
    ];
    const signals: QueueSignal[] = [
      { kind: 'agent_question', severity: 'warning', message: 'Question.', workItemId: 'feature' },
    ];

    const result = rebalanceWorkItems(queue, [], signals);
    const convItems = result.filter(w => w.kind === 'conversation');
    assert.equal(convItems.length, 1, 'Pre-existing conversation item must not be duplicated');
    assert.equal(convItems[0]?.id, conversationId);
  });
});
