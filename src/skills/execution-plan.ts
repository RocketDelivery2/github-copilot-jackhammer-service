import type {
  SkillDocument,
  SkillExecutionPlan,
  SkillExecutionPlanStep,
  SkillExecutionPlanTrustPolicySummary,
} from './types.js';

export type BuildSkillExecutionPlanInput = {
  taskId: string;
  skillName: string;
  selectionRank: number;
  selectionScore: number;
  selectionReasons: readonly string[];
  risk: 'low' | 'medium' | 'high';
  allowedTools: readonly string[];
  document: SkillDocument;
  trustPolicySummary: SkillExecutionPlanTrustPolicySummary;
  maxSteps?: number;
};

export function buildSkillExecutionPlan(input: BuildSkillExecutionPlanInput): SkillExecutionPlan {
  const maxSteps = Math.max(1, Math.floor(input.maxSteps ?? 6));
  const plannedSteps = extractPlannedSteps(input.document.body, maxSteps);

  return {
    taskId: input.taskId,
    skillName: input.skillName,
    selectionRank: input.selectionRank,
    selectionScore: input.selectionScore,
    selectionReasons: [...input.selectionReasons],
    risk: input.risk,
    allowedTools: [...input.allowedTools],
    plannedSteps,
    trustPolicySummary: {
      instructionsReadAllowed: input.trustPolicySummary.instructionsReadAllowed,
      referencesReadAllowed: input.trustPolicySummary.referencesReadAllowed,
      assetsReadAllowed: input.trustPolicySummary.assetsReadAllowed,
      scriptsRequireHumanApproval: input.trustPolicySummary.scriptsRequireHumanApproval,
      scriptsAutoExecutable: input.trustPolicySummary.scriptsAutoExecutable,
      scriptExecutionBlocked: input.trustPolicySummary.scriptExecutionBlocked,
    },
  };
}

export function extractPlannedSteps(body: string, maxSteps: number): SkillExecutionPlanStep[] {
  const numbered = body
    .split(/\r?\n/)
    .map(line => line.trim())
    .map(line => line.match(/^\d+\.\s+(.+)$/)?.[1]?.trim() ?? '')
    .filter(Boolean)
    .slice(0, maxSteps)
    .map((summary, index) => ({ index: index + 1, summary }));

  if (numbered.length > 0) {
    return numbered;
  }

  const fallback = body
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .slice(0, maxSteps)
    .map((summary, index) => ({ index: index + 1, summary }));

  return fallback;
}
