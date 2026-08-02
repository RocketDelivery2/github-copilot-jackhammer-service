import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTO_MERGE_POLICY_LABEL,
  evaluateAutoMergePolicy,
} from '../auto-merge-policy.js';

describe('auto-merge policy', () => {
  it('allows a labeled bot-authored PR when checks and reviews are clean', () => {
    const result = evaluateAutoMergePolicy(
      {
        author: { login: 'renovate[bot]' },
        isDraft: false,
        labels: [{ name: AUTO_MERGE_POLICY_LABEL }],
        reviewDecision: 'APPROVED',
        mergeStateStatus: 'CLEAN',
      },
      { requirePolicyLabel: true },
    );

    assert.equal(result.allowed, true);
    assert.deepEqual(result.blockers, []);
  });

  it('blocks human-authored PRs even when labeled and otherwise clean', () => {
    const result = evaluateAutoMergePolicy(
      {
        author: { login: 'octocat' },
        isDraft: false,
        labels: [{ name: AUTO_MERGE_POLICY_LABEL }],
        reviewDecision: 'APPROVED',
        mergeStateStatus: 'CLEAN',
      },
      { requirePolicyLabel: true },
    );

    assert.equal(result.allowed, false);
    assert.ok(result.blockers.some(blocker => blocker.startsWith('Author gate:')));
  });

  it('blocks until required checks and reviews are ready', () => {
    const result = evaluateAutoMergePolicy(
      {
        author: { login: 'dependabot[bot]' },
        isDraft: false,
        labels: [{ name: AUTO_MERGE_POLICY_LABEL }, { name: 'security' }],
        reviewDecision: 'REVIEW_REQUIRED',
        mergeStateStatus: 'BLOCKED',
      },
      {
        requirePolicyLabel: true,
        approvedBotAuthors: ['dependabot[bot]'],
      },
    );

    assert.equal(result.allowed, false);
    assert.ok(result.blockers.some(blocker => blocker.startsWith('Policy deny-label gate:')));
    assert.ok(result.blockers.some(blocker => blocker.startsWith('Review gate:')));
    assert.ok(result.blockers.some(blocker => blocker.startsWith('Check gate:')));
  });

  it('can gate dependabot-style PRs without a policy label when configured that way', () => {
    const result = evaluateAutoMergePolicy(
      {
        author: { login: 'dependabot[bot]' },
        isDraft: false,
        labels: [],
        reviewDecision: 'APPROVED',
        mergeStateStatus: 'CLEAN',
      },
      {
        requirePolicyLabel: false,
        approvedBotAuthors: ['dependabot[bot]'],
      },
    );

    assert.equal(result.allowed, true);
  });
});

