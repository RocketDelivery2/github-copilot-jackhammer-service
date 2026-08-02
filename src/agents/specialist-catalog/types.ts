/**
 * Specialist Agent Catalog — type definitions.
 *
 * Internal demo codename: Autobots.
 * That name must NOT appear in public APIs, exported package names, or public docs.
 * It may appear only in the `internalThemeAlias` field of SpecialistAgentCard.
 */

export const SPECIALIST_CAPABILITIES = [
  'orchestration',
  'requirements-analysis',
  'architecture-design',
  'security-analysis',
  'qa-design',
  'implementation',
  'performance-analysis',
  'database-design',
  'api-design',
  'devops',
  'observability',
  'accessibility',
  'dependency-review',
  'incident-analysis',
  'documentation',
  'release-governance',
  'code-review',
  'risk-assessment',
] as const;

export type SpecialistCapability = (typeof SPECIALIST_CAPABILITIES)[number];

export type SpecialistRiskTier = 'low' | 'medium' | 'high' | 'critical';

/**
 * Hard limits on what any specialist agent is permitted to do.
 *
 * canMerge, canAdminRepo, and canAccessSecrets are structurally `false` —
 * no agent in this catalog is ever granted those authorities.
 *
 * Agents that need write or execute authority must also carry
 * requiresApprovalToken: true so an out-of-band approval gate is enforced
 * before any write or execute action is performed.
 */
export type AuthorityCeiling = {
  readonly canRead: true;
  readonly canWrite: boolean;
  readonly canExecute: boolean;
  readonly canMerge: false;
  readonly canAdminRepo: false;
  readonly canAccessSecrets: false;
  readonly requiresApprovalToken: boolean;
};

export type SpecialistAgentCard = {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  /** Internal Autobots theme alias. Never expose in public APIs or docs. */
  readonly internalThemeAlias: string;
  readonly capabilities: readonly SpecialistCapability[];
  readonly requiredInputs: readonly string[];
  readonly producedArtifacts: readonly string[];
  readonly allowedActions: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly authorityCeiling: AuthorityCeiling;
  readonly riskTier: SpecialistRiskTier;
  readonly providerPreferences: readonly string[];
  readonly requiredEvidence: readonly string[];
  readonly requiredTests: readonly string[];
  readonly maximumConcurrency: number;
  readonly timeBudgetSeconds: number;
  readonly tokenBudget: number;
  readonly costBudget: number;
  readonly activationConditions: readonly string[];
  readonly stopConditions: readonly string[];
};

/**
 * Signals derived from a repository that the deterministic selector uses
 * to choose which specialist roles to activate.
 */
export type RepositorySignals = {
  readonly hasTypeScript: boolean;
  readonly hasJavaScript: boolean;
  readonly hasPython: boolean;
  readonly hasGo: boolean;
  readonly hasRust: boolean;
  readonly hasJava: boolean;
  readonly hasTests: boolean;
  readonly hasDatabase: boolean;
  readonly hasAPI: boolean;
  readonly hasCI: boolean;
  readonly hasDocker: boolean;
  readonly hasKubernetes: boolean;
  readonly hasTerraform: boolean;
  readonly hasAccessibilityRequirements: boolean;
  readonly hasSecurityConfig: boolean;
  readonly hasDocsFolder: boolean;
  readonly hasDependencyLockfile: boolean;
  readonly hasRecentIncidents: boolean;
  readonly hasOpenAPIDef: boolean;
  readonly hasMigrationFiles: boolean;
  readonly hasPerformanceTests: boolean;
  readonly hasObservabilityConfig: boolean;
  readonly hasReleaseWorkflow: boolean;
  readonly isLibrary: boolean;
};

export type SelectSpecialistsOptions = {
  readonly signals: RepositorySignals;
  /**
   * Feature flag. Defaults to false — catalog selection is opt-in.
   * No agents are activated when false.
   */
  readonly featureEnabled?: boolean;
  /**
   * Hard cap on the number of agents returned. Defaults to DEFAULT_MAX_TEAM_SIZE.
   * Enforced after deduplication and before returning.
   */
  readonly maximumTeamSize?: number;
};

export type SpecialistSelectionResult = {
  readonly selected: readonly SpecialistAgentCard[];
  readonly featureEnabled: boolean;
  readonly teamSize: number;
};

export const DEFAULT_MAX_TEAM_SIZE = 8;
