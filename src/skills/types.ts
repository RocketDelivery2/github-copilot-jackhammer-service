export type SkillRisk = 'low' | 'medium' | 'high';

export type SkillMetadata = {
  name: string;
  description: string;
  version: string;
  risk: SkillRisk;
  allowedTools: readonly string[];
  resourceHints: readonly string[];
  keywords: readonly string[];
  skillPath?: string;
};

export type SkillDocument = {
  metadata: SkillMetadata;
  body: string;
};

export type SkillMetadataIndex = {
  skills: SkillMetadata[];
  generatedAt: string;
};

export type SkillTaskLike = {
  title?: string;
  summary?: string;
  description?: string;
  command?: string;
};

export type SkillMatch = {
  skill: SkillMetadata;
  score: number;
  reasons: string[];
};

export type SkillResourceKind = 'instructions' | 'reference' | 'asset' | 'script' | 'unknown';

export type SkillResourcePolicy = {
  resourcePath: string;
  kind: SkillResourceKind;
  readAllowed: boolean;
  requiresHumanApproval: boolean;
  autoExecutable: boolean;
};

export type SkillExecutionPlanStep = {
  index: number;
  summary: string;
};

export type SkillExecutionPlanTrustPolicySummary = {
  instructionsReadAllowed: boolean;
  referencesReadAllowed: boolean;
  assetsReadAllowed: boolean;
  scriptsRequireHumanApproval: boolean;
  scriptsAutoExecutable: boolean;
  scriptExecutionBlocked: boolean;
};

export type SkillExecutionPlan = {
  taskId: string;
  skillName: string;
  selectionRank: number;
  selectionScore: number;
  selectionReasons: string[];
  risk: SkillRisk;
  allowedTools: string[];
  plannedSteps: SkillExecutionPlanStep[];
  trustPolicySummary: SkillExecutionPlanTrustPolicySummary;
};

export type SkillApprovalState = 'pending' | 'approved' | 'rejected' | 'not_required';

export type SkillApprovalResourceType = 'script' | 'reference' | 'instructions' | 'risk_gate';

export type SkillApprovalCheckpoint = {
  checkpointId: string;
  taskId: string;
  skillName: string;
  resourceType: SkillApprovalResourceType;
  reason: string;
  risk: SkillRisk;
  approvalState: SkillApprovalState;
  createdSource: 'adaptive-preview';
};
