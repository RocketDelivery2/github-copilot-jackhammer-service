import { findAgentsByCapability } from './registry.js';
import type { AgentRegistry } from './registry.js';
import type { AgentCapability, AgentCard, AgentDelegationMessage, AgentRoundTablePlan } from './types.js';

export type CreateDelegationMessageOptions = {
  fromAgentId: string;
  toAgentId: string;
  topic: string;
  payload: Record<string, unknown>;
  requiredCapabilities?: readonly AgentCapability[];
  priority?: AgentDelegationMessage['priority'];
  now?: () => string;
  generateId?: () => string;
};

export function createDelegationMessage(
  options: CreateDelegationMessageOptions,
): AgentDelegationMessage {
  return {
    id: (options.generateId ?? defaultId)(),
    fromAgentId: options.fromAgentId,
    toAgentId: options.toAgentId,
    topic: options.topic,
    payload: { ...options.payload },
    requiredCapabilities: options.requiredCapabilities ?? [],
    priority: options.priority ?? 'medium',
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
}

export type PlanRoundTableOptions = {
  maxParticipants?: number;
  now?: () => string;
};

export function planRoundTable(
  registry: AgentRegistry,
  topic: string,
  requiredCapabilities: readonly AgentCapability[],
  options: PlanRoundTableOptions = {},
): AgentRoundTablePlan {
  const maxParticipants = Math.max(1, Math.floor(options.maxParticipants ?? 8));
  const seen = new Set<string>();
  const participants: AgentCard[] = [];

  for (const capability of requiredCapabilities) {
    for (const agent of findAgentsByCapability(registry, capability)) {
      if (!seen.has(agent.id) && participants.length < maxParticipants) {
        seen.add(agent.id);
        participants.push(agent);
      }
    }
  }

  return {
    topic,
    participants,
    requiredCapabilities,
    maxParticipants,
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
  };
}

function defaultId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
