import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPullRequestAutomationPolicy } from '../runtime-policy.js';

describe('runtime policy', () => {
  it('centralizes PR automation decisions and respects full autopilot', () => {
    const selective = buildPullRequestAutomationPolicy({
      FULL_AUTOPILOT: false,
      AUTO_APPROVE_PR: true,
      AUTO_MERGE_PR: false,
      AUTO_CLOSE_ISSUE: true,
      AUTO_DELETE_BRANCH: false,
      MERGE_METHOD: 'rebase',
    });

    assert.deepEqual(selective, {
      autoApprove: true,
      autoMerge: false,
      closeIssueAfterMerge: true,
      deleteBranchAfterMerge: false,
      mergeMethod: 'rebase',
    });

    const fullAutopilot = buildPullRequestAutomationPolicy({
      FULL_AUTOPILOT: true,
      AUTO_APPROVE_PR: false,
      AUTO_MERGE_PR: false,
      AUTO_CLOSE_ISSUE: false,
      AUTO_DELETE_BRANCH: false,
      MERGE_METHOD: 'squash',
    });

    assert.equal(fullAutopilot.autoApprove, true);
    assert.equal(fullAutopilot.autoMerge, true);
    assert.equal(fullAutopilot.closeIssueAfterMerge, true);
    assert.equal(fullAutopilot.deleteBranchAfterMerge, true);
    assert.equal(fullAutopilot.mergeMethod, 'squash');
  });
});
