import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiTask, RepoSnapshot } from './types.js';
import { assessTaskByIndustryStandards, rankCommandsByIndustryStandards } from './standards.js';

function makeTask(overrides: Partial<AiTask>): AiTask {
  return {
    title: 'Task title placeholder',
    priority: 'medium',
    type: 'feature',
    summary: 'Implement a scoped change with verification steps.',
    target_files: ['src/index.ts'],
    copilot_prompt: 'Make a small, reviewable change and include tests.',
    acceptance_criteria: ['Behavior is correct and validated.', 'No regressions are introduced.'],
    test_plan: ['Run relevant tests.'],
    risk_notes: [],
    ...overrides
  };
}

const unstableSnapshot: RepoSnapshot = {
  owner: 'RocketDelivery2',
  repo: 'TeamBuilder',
  baseBranch: 'main',
  commitSha: 'abc123',
  generatedAt: new Date().toISOString(),
  fileCount: 1,
  files: [{ path: 'README.md', bytes: 10, content: 'example' }],
  recentChanges: 'hotfix: failing build and failing tests in API service',
  packageHints: ['CI pipeline failing and rollback discussed.']
};

test('prioritizes build/test/lint failures highly', () => {
  const task = makeTask({
    type: 'maintenance',
    title: 'Fix failing build and lint checks',
    summary: 'Resolve compile errors, failing tests, and lint failures blocking CI.',
    copilot_prompt: 'Fix failing build and lint checks first. Add regression tests and validation.',
    acceptance_criteria: [
      'Build passes in CI.',
      'Tests pass and lint has zero errors.'
    ],
    test_plan: ['npm test', 'npm run build', 'npm run lint']
  });

  const assessment = assessTaskByIndustryStandards(task, unstableSnapshot);
  assert.equal(assessment.priority, 'high');
  assert.ok(assessment.score >= 70);
});

test('prioritizes security and validation gaps highly', () => {
  const task = makeTask({
    type: 'security',
    title: 'Close validation and auth vulnerability',
    summary: 'Harden request validation and authorization checks to mitigate injection risk.',
    copilot_prompt: 'Add schema validation, strict error handling, and security tests for auth flows.',
    acceptance_criteria: ['Requests are validated with schema rules.', 'Unauthorized access paths are rejected safely.'],
    test_plan: ['Add unit/integration tests covering invalid and malicious payloads.']
  });

  const assessment = assessTaskByIndustryStandards(task);
  assert.equal(assessment.priority, 'high');
  assert.ok(assessment.score >= 60);
});

test('prioritizes API contract stability highly', () => {
  const task = makeTask({
    type: 'bug',
    title: 'Preserve backward compatible API contract',
    summary: 'Stabilize response schema and guarantee backward compatible API contract behavior.',
    copilot_prompt: 'Add compatibility tests and prevent breaking change to the public API.',
    acceptance_criteria: ['Public API remains backward compatible.', 'Contract tests pass.'],
    test_plan: ['Add contract tests for existing consumers.']
  });

  const assessment = assessTaskByIndustryStandards(task);
  assert.equal(assessment.priority, 'high');
  assert.ok(assessment.score >= 60);
});

test('de-prioritizes broad vague refactors', () => {
  const task = makeTask({
    type: 'refactor',
    title: 'General cleanup',
    summary: 'Refactor codebase and improve code quality overall.',
    copilot_prompt: 'Do a misc refactor across many areas.',
    test_plan: [],
    target_files: ['src/index.ts', 'src/openai.ts', 'src/repo.ts', 'src/github.ts', 'src/config.ts', 'README.md']
  });

  const assessment = assessTaskByIndustryStandards(task);
  assert.equal(assessment.priority, 'low');
  assert.ok(assessment.score < 40);
});

test('de-prioritizes large risky rewrites', () => {
  const task = makeTask({
    type: 'feature',
    title: 'Massive rewrite of architecture',
    summary: 'Complete rewrite from scratch with overhaul entire system architecture.',
    copilot_prompt: 'Rewrite from scratch and replace all major modules at once.',
    target_files: ['src/index.ts', 'src/openai.ts', 'src/github.ts', 'src/repo.ts', 'src/state.ts', 'src/config.ts']
  });

  const assessment = assessTaskByIndustryStandards(task);
  assert.equal(assessment.priority, 'low');
  assert.ok(assessment.score < 40);
});

test('orders queue by standards score and blockers first', () => {
  const blockers = makeTask({
    type: 'maintenance',
    title: 'Fix failing build and tests',
    summary: 'CI is red due to failing build and failing tests.',
    copilot_prompt: 'Resolve blockers first and validate with build/test/lint.',
    test_plan: ['npm test', 'npm run build', 'npm run lint']
  });

  const apiStability = makeTask({
    type: 'bug',
    title: 'Stabilize API contract for existing clients',
    summary: 'Prevent breaking change and maintain backward compatible API contract.',
    copilot_prompt: 'Add contract tests and preserve API response schema.',
    test_plan: ['Contract tests for compatibility.']
  });

  const polish = makeTask({
    type: 'docs',
    title: 'UI polish copy updates',
    summary: 'Improve visual polish and cosmetic wording in frontend UI.',
    copilot_prompt: 'Polish UI text only.',
    test_plan: ['Manual smoke check.']
  });

  const ranked = rankCommandsByIndustryStandards([polish, blockers, apiStability], unstableSnapshot);
  assert.equal(ranked[0]?.task.title, blockers.title);
  assert.equal(ranked[ranked.length - 1]?.task.title, polish.title);
});
