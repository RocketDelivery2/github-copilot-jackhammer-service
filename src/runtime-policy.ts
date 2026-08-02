import type { AppConfig } from './config.js';

export type PullRequestAutomationPolicy = {
  autoApprove: boolean;
  autoMerge: boolean;
  closeIssueAfterMerge: boolean;
  deleteBranchAfterMerge: boolean;
  mergeMethod: AppConfig['MERGE_METHOD'];
};

export function buildPullRequestAutomationPolicy(
  config: Pick<
    AppConfig,
    'FULL_AUTOPILOT'
    | 'AUTO_APPROVE_PR'
    | 'AUTO_MERGE_PR'
    | 'AUTO_CLOSE_ISSUE'
    | 'AUTO_DELETE_BRANCH'
    | 'MERGE_METHOD'
  >,
): PullRequestAutomationPolicy {
  return {
    autoApprove: config.FULL_AUTOPILOT || config.AUTO_APPROVE_PR,
    autoMerge: config.FULL_AUTOPILOT || config.AUTO_MERGE_PR,
    closeIssueAfterMerge: config.FULL_AUTOPILOT || config.AUTO_CLOSE_ISSUE,
    deleteBranchAfterMerge: config.FULL_AUTOPILOT || config.AUTO_DELETE_BRANCH,
    mergeMethod: config.MERGE_METHOD,
  };
}
