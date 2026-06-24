import type { SkillApprovalCheckpoint, SkillExecutionPlan } from './types.js';

export type BuildSkillApprovalCheckpointsOptions = {
  plans: readonly SkillExecutionPlan[];
  maxCheckpoints?: number;
};

export function buildSkillApprovalCheckpoints(
  options: BuildSkillApprovalCheckpointsOptions,
): SkillApprovalCheckpoint[] {
  const maxCheckpoints = Math.max(0, Math.floor(options.maxCheckpoints ?? 16));
  if (maxCheckpoints === 0) {
    return [];
  }

  const checkpoints: SkillApprovalCheckpoint[] = [];

  for (const plan of options.plans) {
    checkpoints.push({
      checkpointId: `script:${plan.taskId}:${plan.skillName}`,
      taskId: plan.taskId,
      skillName: plan.skillName,
      resourceType: 'script',
      reason: plan.trustPolicySummary.scriptsRequireHumanApproval
        ? 'Script-capable resources require explicit human approval in preview.'
        : 'No script-capable resources require approval.',
      risk: plan.risk,
      approvalState: plan.trustPolicySummary.scriptsRequireHumanApproval ? 'pending' : 'not_required',
      createdSource: 'adaptive-preview',
    });

    if (plan.risk === 'high') {
      checkpoints.push({
        checkpointId: `risk:${plan.taskId}:${plan.skillName}`,
        taskId: plan.taskId,
        skillName: plan.skillName,
        resourceType: 'risk_gate',
        reason: 'High-risk skill plan requires explicit human approval.',
        risk: plan.risk,
        approvalState: 'pending',
        createdSource: 'adaptive-preview',
      });
    } else {
      checkpoints.push({
        checkpointId: `risk:${plan.taskId}:${plan.skillName}`,
        taskId: plan.taskId,
        skillName: plan.skillName,
        resourceType: 'risk_gate',
        reason: 'Risk gate approval not required for non-high-risk preview plan.',
        risk: plan.risk,
        approvalState: 'not_required',
        createdSource: 'adaptive-preview',
      });
    }
  }

  checkpoints.sort((left, right) => left.checkpointId.localeCompare(right.checkpointId));
  return checkpoints.slice(0, maxCheckpoints);
}
