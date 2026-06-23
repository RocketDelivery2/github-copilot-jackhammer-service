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
