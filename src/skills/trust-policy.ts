import path from 'node:path';
import type { SkillResourceKind, SkillResourcePolicy } from './types.js';

export type SkillExecutionPolicyOptions = {
  humanApproved?: boolean;
  allowScriptExecution?: boolean;
};

export function classifySkillResource(resourcePath: string): SkillResourceKind {
  const normalized = resourcePath.replace(/\\/g, '/').toLowerCase();
  const ext = path.posix.extname(normalized);
  const fileName = path.posix.basename(normalized);

  if (normalized.includes('/scripts/') || ['.sh', '.ps1', '.cmd', '.bat', '.js', '.ts', '.py'].includes(ext)) {
    return 'script';
  }
  if (fileName === 'skill.md') {
    return 'instructions';
  }
  if (['.md', '.txt', '.json', '.yaml', '.yml'].includes(ext)) {
    return 'reference';
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf'].includes(ext)) {
    return 'asset';
  }
  return 'unknown';
}

export function evaluateSkillResourcePolicy(resourcePath: string): SkillResourcePolicy {
  const kind = classifySkillResource(resourcePath);

  if (kind === 'script') {
    return {
      resourcePath,
      kind,
      readAllowed: true,
      requiresHumanApproval: true,
      autoExecutable: false,
    };
  }

  if (kind === 'instructions' || kind === 'reference' || kind === 'asset') {
    return {
      resourcePath,
      kind,
      readAllowed: true,
      requiresHumanApproval: false,
      autoExecutable: false,
    };
  }

  return {
    resourcePath,
    kind,
    readAllowed: false,
    requiresHumanApproval: true,
    autoExecutable: false,
  };
}

export function isSkillResourceExecutionAllowed(
  resourcePath: string,
  options: SkillExecutionPolicyOptions = {},
): boolean {
  const policy = evaluateSkillResourcePolicy(resourcePath);
  if (policy.kind !== 'script') {
    return false;
  }
  return Boolean(options.humanApproved && options.allowScriptExecution);
}
