import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractCommandCandidates } from './parser.js';
import { canRunInParallel, planRunnableBatch } from './parallelism.js';
import { rebalanceWorkItems } from './rebalance.js';
import { classifyExecutionSignals } from './signals.js';
import type { QueueSignal, WorkItem } from './types.js';

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
