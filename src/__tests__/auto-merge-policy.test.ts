import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTO_MERGE_POLICY_LABEL,
  evaluateAutoMergePolicy,
  type AutoMergePolicyInput,
} from '../auto-merge-policy.js';

const headSha = 'a'.repeat(40);

function allowedContext(overrides: Partial<AutoMergePolicyInput> = {}): AutoMergePolicyInput {
  const files = overrides.files ?? ['docs/example.md', 'src/__tests__/example.test.ts'];
  return {
    number: 42,
    url: 'https://github.com/RocketDelivery2/github-copilot-jackhammer-service/pull/42',
    author: { login: 'dependabot[bot]' },
    headCommitAuthor: { login: 'dependabot[bot]' },
    isDraft: false,
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: 'dependabot/npm_and_yarn/example-1.2.3',
    headSha,
    files,
    changedFileCount: overrides.changedFileCount ?? files.length,
    checks: [
      { name: 'test-and-build', status: 'COMPLETED', conclusion: 'SUCCESS', headSha },
      { name: 'Analyze (javascript-typescript)', status: 'COMPLETED', conclusion: 'SUCCESS', headSha },
    ],
    labels: [{ name: AUTO_MERGE_POLICY_LABEL }],
    reviews: [{ login: 'maintainer', state: 'APPROVED' }],
    reviewDecision: 'APPROVED',
    mergeStateStatus: 'CLEAN',
    dependencyUpdateType: null,
    dependencyType: null,
    autoMergeEnabled: false,
    ...overrides,
  };
}

describe('auto-merge policy', () => {
  it('allows an exact allowlisted bot PR only with independent approval and exact-head checks', () => {
    const result = evaluateAutoMergePolicy(allowedContext());
    assert.equal(result.allowed, true);
    assert.equal(result.doArm, true);
    assert.deepEqual(result.blockers, []);
  });

  it('blocks human-authored PRs despite labels, approvals, and green checks', () => {
    const result = evaluateAutoMergePolicy(allowedContext({
      author: { login: 'octocat' },
      headCommitAuthor: { login: 'octocat' },
      headRefName: 'docs/example',
    }));
    assert.equal(result.allowed, false);
    assert.ok(result.blockers.some(blocker => blocker.startsWith('Author gate:')));
  });

  it('blocks author laundering through the workflow bot', () => {
    const result = evaluateAutoMergePolicy(allowedContext({
      author: { login: 'github-actions[bot]' },
      headCommitAuthor: { login: 'octocat' },
      headRefName: 'automation/generated-docs',
    }), { approvedBotAuthors: ['github-actions[bot]'] });
    assert.equal(result.allowed, false);
    assert.ok(result.blockers.some(blocker => blocker.startsWith('Author gate:')));
    assert.ok(result.blockers.some(blocker => blocker.startsWith('Branch gate:')));
  });

  it('blocks when the PR author and head commit author do not match', () => {
    const result = evaluateAutoMergePolicy(allowedContext({
      headCommitAuthor: { login: 'github-actions[bot]' },
    }));
    assert.equal(result.allowed, false);
    assert.ok(result.blockers.some(blocker => blocker.startsWith('Author gate:')));
  });

  it('blocks an unsupported bot and a bot outside its exact branch prefix', () => {
    const unsupported = evaluateAutoMergePolicy(allowedContext({
      author: { login: 'some-bot[bot]' },
      headCommitAuthor: { login: 'some-bot[bot]' },
      headRefName: 'some-bot/docs',
    }));
    const wrongPrefix = evaluateAutoMergePolicy(allowedContext({ headRefName: 'automation/docs' }));
    assert.equal(unsupported.allowed, false);
    assert.equal(wrongPrefix.allowed, false);
    assert.ok(wrongPrefix.blockers.some(blocker => blocker.startsWith('Branch gate:')));
  });

  it('blocks malformed or empty policy input without throwing', () => {
    for (const input of [null, {}, { author: { login: 'dependabot[bot]' } }]) {
      const result = evaluateAutoMergePolicy(input);
      assert.equal(result.allowed, false);
      assert.equal(result.doArm, false);
      assert.ok(result.blockers.some(blocker => blocker.startsWith('Context gate:')));
    }
  });

  it('blocks deny labels including no-auto-merge', () => {
    for (const denyLabel of ['security', 'breaking-change', 'do-not-merge', 'no-auto-merge', 'NO-AUTO-MERGE']) {
      const result = evaluateAutoMergePolicy(allowedContext({ labels: [{ name: AUTO_MERGE_POLICY_LABEL }, { name: denyLabel }] }));
      assert.equal(result.allowed, false, denyLabel);
      assert.ok(result.blockers.some(blocker => blocker.startsWith('Policy deny-label gate:')));
    }
  });

  it('blocks .github, package/lockfile, runtime-policy, and traversal paths', () => {
    for (const filePath of [
      '.github/workflows/test.yml',
      'docs/.github/review.md',
      'package.json',
      'nested/package-lock.json',
      'packages/example/package.json',
      'docs/package-extra.json',
      'docs/example.lock',
      'docs/pnpm-lock.yaml',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'src/config.ts',
      'src/github.ts',
      'docs/../src/github.ts',
      'docs\\..\\src\\github.ts',
      'C:\\repo\\docs\\readme.md',
      '',
    ]) {
      const result = evaluateAutoMergePolicy(allowedContext({ files: [filePath] }));
      assert.equal(result.allowed, false, filePath);
      assert.ok(result.blockers.some(blocker => blocker.startsWith('Changed-file gate:')));
    }
  });

  it('blocks non-documentation and non-test changes', () => {
    const result = evaluateAutoMergePolicy(allowedContext({ files: ['src/index.ts'] }));
    assert.equal(result.allowed, false);
  });

  it('blocks when the changed-file metadata is incomplete or inconsistent', () => {
    const result = evaluateAutoMergePolicy(allowedContext({ changedFileCount: 3 }));
    assert.equal(result.allowed, false);
    assert.ok(result.blockers.some(blocker => blocker.startsWith('Changed-file gate:')));
  });

  it('requires an explicit independent non-bot review decision', () => {
    for (const context of [
      allowedContext({ reviewDecision: null }),
      allowedContext({ reviewDecision: 'REVIEW_REQUIRED' }),
      allowedContext({ reviews: [] }),
      allowedContext({ reviews: [{ login: 'dependabot[bot]', state: 'APPROVED' }] }),
      allowedContext({ reviews: [{ login: 'maintainer[bot]', state: 'APPROVED' }] }),
      allowedContext({ reviews: [{ login: 'dependabot[bot]', state: 'APPROVED' }, { login: 'octocat', state: 'COMMENTED' }] }),
    ]) {
      const result = evaluateAutoMergePolicy(context);
      assert.equal(result.allowed, false);
      assert.ok(result.blockers.some(blocker => blocker.startsWith('Review gate:')));
    }
  });

  it('requires each required status check to pass against the exact head SHA', () => {
    const cases = [
      allowedContext({ checks: [] }),
      allowedContext({ checks: [{ name: 'test-and-build', status: 'COMPLETED', conclusion: 'SUCCESS', headSha }] }),
      allowedContext({ checks: [
        { name: 'test-and-build', status: 'COMPLETED', conclusion: 'SUCCESS', headSha: 'b'.repeat(40) },
        { name: 'Analyze (javascript-typescript)', status: 'COMPLETED', conclusion: 'SUCCESS', headSha },
      ] }),
      allowedContext({ checks: [
        { name: 'test-and-build', status: 'IN_PROGRESS', conclusion: null, headSha },
        { name: 'Analyze (javascript-typescript)', status: 'COMPLETED', conclusion: 'SUCCESS', headSha },
      ] }),
    ];
    for (const context of cases) {
      const result = evaluateAutoMergePolicy(context);
      assert.equal(result.allowed, false);
      assert.ok(result.blockers.some(blocker => blocker.startsWith('Check gate:')));
    }
  });

  it('blocks empty review decisions and non-clean or unknown merge states', () => {
    for (const mergeStateStatus of [null, 'BLOCKED', 'DIRTY', 'UNSTABLE']) {
      const result = evaluateAutoMergePolicy(allowedContext({ mergeStateStatus }));
      assert.equal(result.allowed, false);
      assert.ok(result.blockers.some(blocker => blocker.startsWith('Merge-state gate:')));
    }
  });

  it('blocks closed PRs, drafts, and non-main targets', () => {
    for (const overrides of [{ state: 'CLOSED' }, { isDraft: true }, { baseRefName: 'release' }]) {
      assert.equal(evaluateAutoMergePolicy(allowedContext(overrides)).allowed, false);
    }
  });

  it('requires Dependabot metadata and allows only patch or minor updates in that mode', () => {
    for (const dependencyUpdateType of ['version-update:semver-patch', 'version-update:semver-minor']) {
      const result = evaluateAutoMergePolicy(allowedContext({
        dependencyUpdateType,
        dependencyType: 'direct:development',
        files: ['package.json', 'package-lock.json'],
      }), { requireDependencyUpdateType: true, requirePolicyLabel: false });
      assert.equal(result.allowed, true, dependencyUpdateType);
    }
    for (const dependencyUpdateType of [null, 'version-update:semver-major', 'unknown']) {
      const result = evaluateAutoMergePolicy(allowedContext({
        dependencyUpdateType,
        dependencyType: 'direct:development',
        files: ['package.json', 'package-lock.json'],
      }), { requireDependencyUpdateType: true, requirePolicyLabel: false });
      assert.equal(result.allowed, false, String(dependencyUpdateType));
      assert.ok(result.blockers.some(blocker => blocker.startsWith('Dependency update gate:')));
    }
    assert.equal(evaluateAutoMergePolicy(allowedContext({
      dependencyUpdateType: 'version-update:semver-patch',
      dependencyType: 'direct:production',
      files: ['package.json'],
    }), { requireDependencyUpdateType: true, requirePolicyLabel: false }).allowed, false);
  });

  it('can omit the policy label only when explicitly configured', () => {
    const result = evaluateAutoMergePolicy(allowedContext({ labels: [] }), { requirePolicyLabel: false });
    assert.equal(result.allowed, true);
  });

  it('does not repeat an already armed auto-merge request', () => {
    const result = evaluateAutoMergePolicy(allowedContext({ autoMergeEnabled: true }));
    assert.equal(result.allowed, true);
    assert.equal(result.doArm, false);
  });
});
