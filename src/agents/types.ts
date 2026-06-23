export type AgentCostTier = 'low' | 'medium' | 'high' | 'critical';

export type AgentCapability =
  | 'orchestration'
  | 'product-planning'
  | 'architecture-design'
  | 'multi-agent-coordination'
  | 'a2a-communication'
  | 'mcp-tool-access'
  | 'minimal-change-implementation'
  | 'code-review'
  | 'security-review'
  | 'appsec-review'
  | 'test-design'
  | 'test-analysis'
  | 'devops-automation'
  | 'cost-analysis'
  | 'documentation'
  | 'release-management'
  | 'dependency-analysis'
  | 'dry-run-validation';

export type AgentRole =
  | 'orchestrator'
  | 'product-manager'
  | 'software-architect'
  | 'multi-agent-systems-architect'
  | 'minimal-change-engineer'
  | 'code-reviewer'
  | 'security-architect'
  | 'appsec-engineer'
  | 'qa-test-engineer'
  | 'test-results-analyzer'
  | 'devops-sre'
  | 'cost-optimizer'
  | 'technical-writer'
  | 'release-manager';

export type AgentToolAccess = {
  tool: string;
  access: 'read' | 'write' | 'execute' | 'denied';
  scope?: string;
};

export type AgentCard = {
  id: string;
  name: string;
  role: AgentRole;
  responsibilities: readonly string[];
  capabilities: readonly AgentCapability[];
  allowedTools: readonly string[];
  deniedTools: readonly string[];
  readScopes: readonly string[];
  writeScopes: readonly string[];
  maxCostTier: AgentCostTier;
  maxParallelism: number;
  requiresHumanApprovalFor: readonly string[];
  handoffTargets: readonly AgentRole[];
  safetyRules: readonly string[];
};

export type AgentBudgetPolicy = {
  agentId: string;
  maxCostTier: AgentCostTier;
  maxTokensPerTask?: number;
  maxActionsPerRun?: number;
  dryRunFirst: boolean;
  requiresApprovalAboveTier?: AgentCostTier;
};

export type AgentDelegationMessage = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  topic: string;
  payload: Record<string, unknown>;
  requiredCapabilities: readonly AgentCapability[];
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
};

export type AgentArtifactKind =
  | 'analysis'
  | 'plan'
  | 'review'
  | 'decision'
  | 'report'
  | 'patch'
  | 'test-results';

export type AgentArtifact = {
  id: string;
  agentId: string;
  kind: AgentArtifactKind;
  title: string;
  content: string;
  createdAt: string;
  workItemId?: string;
};

export type AgentDecisionKind = 'approve' | 'reject' | 'defer' | 'escalate';

export type AgentDecision = {
  agentId: string;
  topic: string;
  decision: AgentDecisionKind;
  rationale: string;
  requiresHumanApproval: boolean;
  createdAt: string;
};

export type AgentRoundTablePlan = {
  topic: string;
  participants: AgentCard[];
  requiredCapabilities: readonly AgentCapability[];
  maxParticipants: number;
  createdAt: string;
};

export type TaskRisk = 'low' | 'medium' | 'high' | 'critical';
