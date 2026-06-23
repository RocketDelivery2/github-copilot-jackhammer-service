import type { AgentCard, AgentCostTier, TaskRisk } from './types.js';

export type AgentCardValidationResult = {
  valid: boolean;
  errors: string[];
};

const VALID_COST_TIERS: readonly AgentCostTier[] = ['low', 'medium', 'high', 'critical'];

const COST_TIER_RANK: Record<AgentCostTier, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const TASK_RISK_BUMP: Record<TaskRisk, number> = {
  low: 0,
  medium: 1,
  high: 1,
  critical: 2,
};

export function validateAgentCard(card: AgentCard): AgentCardValidationResult {
  const errors: string[] = [];

  if (!card.id || typeof card.id !== 'string') {
    errors.push('id must be a non-empty string');
  }
  if (!card.name || typeof card.name !== 'string') {
    errors.push('name must be a non-empty string');
  }
  if (!card.role || typeof card.role !== 'string') {
    errors.push('role must be a non-empty string');
  }
  if (!Array.isArray(card.responsibilities)) {
    errors.push('responsibilities must be an array');
  }
  if (!Array.isArray(card.capabilities) || card.capabilities.length === 0) {
    errors.push('capabilities must be a non-empty array');
  }
  if (!Array.isArray(card.allowedTools)) {
    errors.push('allowedTools must be an array');
  }
  if (!Array.isArray(card.deniedTools)) {
    errors.push('deniedTools must be an array');
  }
  if (!Array.isArray(card.readScopes)) {
    errors.push('readScopes must be an array');
  }
  if (!Array.isArray(card.writeScopes)) {
    errors.push('writeScopes must be an array');
  }
  if (!VALID_COST_TIERS.includes(card.maxCostTier)) {
    errors.push(`maxCostTier must be one of: ${VALID_COST_TIERS.join(', ')}`);
  }
  if (!Number.isInteger(card.maxParallelism) || card.maxParallelism < 1) {
    errors.push('maxParallelism must be a positive integer');
  }
  if (!Array.isArray(card.requiresHumanApprovalFor)) {
    errors.push('requiresHumanApprovalFor must be an array');
  }
  if (!Array.isArray(card.handoffTargets)) {
    errors.push('handoffTargets must be an array');
  }
  if (!Array.isArray(card.safetyRules)) {
    errors.push('safetyRules must be an array');
  }

  return { valid: errors.length === 0, errors };
}

export function estimateAgentCostTier(card: AgentCard, taskRisk: TaskRisk): AgentCostTier {
  const baseRank = COST_TIER_RANK[card.maxCostTier];
  const bump = TASK_RISK_BUMP[taskRisk];
  const estimatedRank = Math.min(baseRank + bump, COST_TIER_RANK.critical);
  return VALID_COST_TIERS[estimatedRank] as AgentCostTier;
}
