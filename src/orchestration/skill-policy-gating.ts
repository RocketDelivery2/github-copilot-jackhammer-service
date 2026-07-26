import { evaluateSkillResourcePolicy } from '../skills/trust-policy.js';

export type AdaptivePreviewTrustPolicySummary = {
  instructionsReadAllowed: boolean;
  referencesReadAllowed: boolean;
  assetsReadAllowed: boolean;
  scriptsRequireHumanApproval: boolean;
  scriptsAutoExecutable: boolean;
};

export type SkillTrustPolicyStrategyInput = {
  skillPath: string | undefined;
  skillName: string;
};

export type SkillTrustPolicyStrategy = (
  input: SkillTrustPolicyStrategyInput,
) => AdaptivePreviewTrustPolicySummary;

export const evaluateDefaultSkillTrustPolicy: SkillTrustPolicyStrategy = input => {
  const basePath = normalizeSkillBasePath(input.skillPath, input.skillName);
  const instructionsPolicy = evaluateSkillResourcePolicy(`${basePath}/skill.md`);
  const referencesPolicy = evaluateSkillResourcePolicy(`${basePath}/references/reference.md`);
  const assetsPolicy = evaluateSkillResourcePolicy(`${basePath}/assets/asset.txt`);
  const scriptsPolicy = evaluateSkillResourcePolicy(`${basePath}/scripts/example.ps1`);

  return {
    instructionsReadAllowed: instructionsPolicy.readAllowed,
    referencesReadAllowed: referencesPolicy.readAllowed,
    assetsReadAllowed: assetsPolicy.readAllowed,
    scriptsRequireHumanApproval: scriptsPolicy.requiresHumanApproval,
    scriptsAutoExecutable: scriptsPolicy.autoExecutable,
  };
};

export function normalizeSkillBasePath(skillPath: string | undefined, skillName: string): string {
  if (!skillPath || skillPath.trim().length === 0) {
    return `skills/${skillName}`;
  }

  const normalized = skillPath.replace(/\\/g, '/');
  const suffix = '/skill.md';
  if (normalized.toLowerCase().endsWith(suffix)) {
    return normalized.slice(0, -suffix.length);
  }
  return normalized;
}
