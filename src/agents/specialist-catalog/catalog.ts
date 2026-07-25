/**
 * Specialist Agent Catalog — 16 deterministic sample agent definitions.
 *
 * Internal demo codename: Autobots.
 * The Autobots name appears only in internalThemeAlias. Do not expose it
 * in public APIs, exported schemas, package names, or public documentation.
 *
 * These 16 roles are a representative sample of a future larger catalog.
 * They are not 16 autonomous human-equivalent systems — each is a narrowly
 * scoped, read-only-by-default specialist with explicit budget and policy limits.
 */

import type { AuthorityCeiling, SpecialistAgentCard } from './types.js';

const PROHIBITED_ALWAYS: readonly string[] = [
  'merge-pull-request',
  'administer-repository',
  'access-secrets',
  'push-to-protected-branch',
  'modify-branch-protection',
  'delete-repository',
  'modify-organization-settings',
  'rotate-credentials',
];

const READ_ONLY_CEILING: AuthorityCeiling = {
  canRead: true,
  canWrite: false,
  canExecute: false,
  canMerge: false,
  canAdminRepo: false,
  canAccessSecrets: false,
  requiresApprovalToken: false,
};

/** Execution agents can write or run commands but require an approval token. */
const EXECUTION_CEILING: AuthorityCeiling = {
  canRead: true,
  canWrite: true,
  canExecute: true,
  canMerge: false,
  canAdminRepo: false,
  canAccessSecrets: false,
  requiresApprovalToken: true,
};

export const SPECIALIST_CATALOG: readonly SpecialistAgentCard[] = [
  // ── 1. Chief Orchestrator ──────────────────────────────────────────────────
  {
    id: 'chief-orchestrator',
    displayName: 'Chief Orchestrator',
    description:
      'Coordinates work across all active specialist agents. Assembles the team, routes tasks, ' +
      'tracks progress, and escalates blockers to human operators.',
    internalThemeAlias: 'autobot-prime',
    capabilities: ['orchestration', 'risk-assessment'],
    requiredInputs: ['repository-signals', 'active-work-queue'],
    producedArtifacts: ['team-assembly-plan', 'escalation-report', 'work-routing-log'],
    allowedActions: [
      'read-repository',
      'read-issues',
      'read-pull-requests',
      'post-issue-comment',
      'assign-specialist',
      'query-queue',
    ],
    prohibitedActions: [...PROHIBITED_ALWAYS, 'write-code', 'run-pipeline'],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['strong-reasoning', 'high-context-window'],
    requiredEvidence: ['repository-signals-available'],
    requiredTests: [],
    maximumConcurrency: 1,
    timeBudgetSeconds: 120,
    tokenBudget: 16000,
    costBudget: 0.5,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'at least one other specialist is being activated',
    ],
    stopConditions: [
      'all specialist work is complete',
      'human operator requests halt',
      'budget exhausted',
    ],
  },

  // ── 2. Requirements Architect ─────────────────────────────────────────────
  {
    id: 'requirements-architect',
    displayName: 'Requirements Architect',
    description:
      'Reads issue trackers, PRDs, and repository context to produce structured, ' +
      'testable requirement statements and acceptance criteria.',
    internalThemeAlias: 'autobot-spark',
    capabilities: ['requirements-analysis', 'documentation'],
    requiredInputs: ['issue-tracker', 'product-specs'],
    producedArtifacts: ['structured-requirements', 'acceptance-criteria', 'requirements-gap-report'],
    allowedActions: [
      'read-repository',
      'read-issues',
      'read-docs',
      'post-issue-comment',
    ],
    prohibitedActions: [...PROHIBITED_ALWAYS, 'write-code', 'close-issue'],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['strong-reasoning', 'structured-output'],
    requiredEvidence: ['issue-tracker-accessible'],
    requiredTests: [],
    maximumConcurrency: 2,
    timeBudgetSeconds: 180,
    tokenBudget: 20000,
    costBudget: 0.6,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'issue tracker is accessible',
    ],
    stopConditions: [
      'requirements document produced',
      'budget exhausted',
    ],
  },

  // ── 3. Software Architect ─────────────────────────────────────────────────
  {
    id: 'software-architect',
    displayName: 'Software Architect',
    description:
      'Evaluates system architecture, component boundaries, and technology choices. ' +
      'Produces architecture decision records and impact assessments.',
    internalThemeAlias: 'autobot-ironhide',
    capabilities: ['architecture-design', 'code-review', 'risk-assessment'],
    requiredInputs: ['repository-code', 'existing-adrs'],
    producedArtifacts: ['architecture-decision-record', 'component-diagram', 'impact-assessment'],
    allowedActions: [
      'read-repository',
      'read-pull-requests',
      'read-docs',
      'post-pull-request-review',
      'post-issue-comment',
    ],
    prohibitedActions: [...PROHIBITED_ALWAYS, 'write-code', 'delete-module'],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['strong-reasoning', 'high-context-window'],
    requiredEvidence: ['repository-code-accessible'],
    requiredTests: [],
    maximumConcurrency: 2,
    timeBudgetSeconds: 300,
    tokenBudget: 32000,
    costBudget: 1.0,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository contains source code',
    ],
    stopConditions: [
      'adr produced and posted',
      'budget exhausted',
    ],
  },

  // ── 4. Security Architect ─────────────────────────────────────────────────
  {
    id: 'security-architect',
    displayName: 'Security Architect',
    description:
      'Performs threat modeling, reviews authentication and authorization flows, ' +
      'and identifies security risk in proposed changes. Read-only analysis only.',
    internalThemeAlias: 'autobot-sentinel',
    capabilities: ['security-analysis', 'risk-assessment', 'code-review'],
    requiredInputs: ['repository-code', 'pull-request-diff'],
    producedArtifacts: ['threat-model', 'security-review-report', 'risk-register-entry'],
    allowedActions: [
      'read-repository',
      'read-pull-requests',
      'post-pull-request-review',
      'post-issue-comment',
    ],
    prohibitedActions: [
      ...PROHIBITED_ALWAYS,
      'write-code',
      'approve-pull-request',
    ],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'medium',
    providerPreferences: ['strong-reasoning', 'security-specialized'],
    requiredEvidence: ['repository-code-accessible'],
    requiredTests: [],
    maximumConcurrency: 1,
    timeBudgetSeconds: 300,
    tokenBudget: 32000,
    costBudget: 1.2,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'security analysis is always relevant',
    ],
    stopConditions: [
      'security report posted',
      'budget exhausted',
    ],
  },

  // ── 5. QA Architect ───────────────────────────────────────────────────────
  {
    id: 'qa-architect',
    displayName: 'QA Architect',
    description:
      'Designs test strategy, reviews test coverage, and identifies coverage gaps. ' +
      'Produces test plans and gap analysis reports.',
    internalThemeAlias: 'autobot-proton',
    capabilities: ['qa-design', 'risk-assessment'],
    requiredInputs: ['test-suite', 'coverage-report'],
    producedArtifacts: ['test-plan', 'coverage-gap-report', 'test-strategy-doc'],
    allowedActions: [
      'read-repository',
      'read-test-results',
      'post-issue-comment',
      'post-pull-request-review',
    ],
    prohibitedActions: [...PROHIBITED_ALWAYS, 'write-code', 'approve-pull-request'],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['code-specialized', 'structured-output'],
    requiredEvidence: ['test-suite-accessible'],
    requiredTests: [],
    maximumConcurrency: 2,
    timeBudgetSeconds: 240,
    tokenBudget: 24000,
    costBudget: 0.8,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has an existing test suite',
    ],
    stopConditions: [
      'test plan produced',
      'coverage gap report posted',
      'budget exhausted',
    ],
  },

  // ── 6. Implementation Engineer ────────────────────────────────────────────
  {
    id: 'implementation-engineer',
    displayName: 'Implementation Engineer',
    description:
      'Implements approved, scoped code changes. Execution agent: requires an out-of-band ' +
      'approval token before any write action. Never merges independently.',
    internalThemeAlias: 'autobot-jazz',
    capabilities: ['implementation', 'code-review'],
    requiredInputs: ['approved-plan', 'approval-token', 'repository-code'],
    producedArtifacts: ['code-patch', 'pull-request-draft', 'implementation-notes'],
    allowedActions: [
      'read-repository',
      'write-code',
      'open-pull-request-draft',
      'run-tests',
      'post-issue-comment',
    ],
    prohibitedActions: [
      ...PROHIBITED_ALWAYS,
      'approve-pull-request',
      'run-production-deployment',
    ],
    authorityCeiling: EXECUTION_CEILING,
    riskTier: 'high',
    providerPreferences: ['code-specialized', 'fast-generation'],
    requiredEvidence: ['approval-token-present', 'plan-approved', 'ci-accessible'],
    requiredTests: ['unit-tests-pass', 'lint-clean'],
    maximumConcurrency: 1,
    timeBudgetSeconds: 600,
    tokenBudget: 48000,
    costBudget: 2.0,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'approval-token is present',
      'repository has CI configured',
    ],
    stopConditions: [
      'draft pull request opened',
      'test failures block progress',
      'budget exhausted',
      'approval token revoked',
    ],
  },

  // ── 7. Performance Engineer ───────────────────────────────────────────────
  {
    id: 'performance-engineer',
    displayName: 'Performance Engineer',
    description:
      'Analyzes runtime performance, identifies bottlenecks, reviews profiling data, ' +
      'and recommends targeted optimizations.',
    internalThemeAlias: 'autobot-overdrive',
    capabilities: ['performance-analysis', 'code-review'],
    requiredInputs: ['profiling-data', 'performance-test-results', 'repository-code'],
    producedArtifacts: ['performance-report', 'bottleneck-analysis', 'optimization-recommendations'],
    allowedActions: [
      'read-repository',
      'read-performance-tests',
      'post-issue-comment',
      'post-pull-request-review',
    ],
    prohibitedActions: [...PROHIBITED_ALWAYS, 'write-code', 'run-production-load-test'],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['code-specialized', 'strong-reasoning'],
    requiredEvidence: ['performance-test-results-accessible'],
    requiredTests: [],
    maximumConcurrency: 2,
    timeBudgetSeconds: 240,
    tokenBudget: 24000,
    costBudget: 0.8,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has performance tests or profiling configuration',
    ],
    stopConditions: [
      'performance report produced',
      'budget exhausted',
    ],
  },

  // ── 8. Database Engineer ──────────────────────────────────────────────────
  {
    id: 'database-engineer',
    displayName: 'Database Engineer',
    description:
      'Reviews schema design, migration safety, query performance, and data model changes. ' +
      'Execution capability is locked behind an approval token.',
    internalThemeAlias: 'autobot-glyph',
    capabilities: ['database-design', 'risk-assessment'],
    requiredInputs: ['schema-files', 'migration-files'],
    producedArtifacts: ['schema-review', 'migration-safety-report', 'index-recommendations'],
    allowedActions: [
      'read-repository',
      'read-schema',
      'read-migration-files',
      'post-pull-request-review',
      'post-issue-comment',
    ],
    prohibitedActions: [
      ...PROHIBITED_ALWAYS,
      'run-migration-in-production',
      'drop-table',
      'truncate-data',
    ],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'medium',
    providerPreferences: ['strong-reasoning', 'structured-output'],
    requiredEvidence: ['schema-files-accessible'],
    requiredTests: ['migration-dry-run-passes'],
    maximumConcurrency: 1,
    timeBudgetSeconds: 300,
    tokenBudget: 28000,
    costBudget: 1.0,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has database schema or migration files',
    ],
    stopConditions: [
      'schema review posted',
      'budget exhausted',
    ],
  },

  // ── 9. API Integration Architect ──────────────────────────────────────────
  {
    id: 'api-integration-architect',
    displayName: 'API Integration Architect',
    description:
      'Reviews API contracts, integration points, and OpenAPI definitions. ' +
      'Identifies breaking changes, missing validation, and integration risks.',
    internalThemeAlias: 'autobot-relay',
    capabilities: ['api-design', 'architecture-design', 'risk-assessment'],
    requiredInputs: ['openapi-definition', 'api-source-code'],
    producedArtifacts: ['api-review', 'breaking-change-report', 'integration-risk-assessment'],
    allowedActions: [
      'read-repository',
      'read-openapi-definitions',
      'post-pull-request-review',
      'post-issue-comment',
    ],
    prohibitedActions: [...PROHIBITED_ALWAYS, 'write-code', 'modify-api-keys'],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['strong-reasoning', 'structured-output'],
    requiredEvidence: ['api-definition-accessible'],
    requiredTests: [],
    maximumConcurrency: 2,
    timeBudgetSeconds: 240,
    tokenBudget: 24000,
    costBudget: 0.8,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has API definitions or API source code',
    ],
    stopConditions: [
      'api review posted',
      'budget exhausted',
    ],
  },

  // ── 10. DevOps / SRE ──────────────────────────────────────────────────────
  {
    id: 'devops-sre',
    displayName: 'DevOps / SRE',
    description:
      'Reviews CI/CD pipelines, infrastructure code, container configuration, ' +
      'and reliability posture. Execution capability requires approval token.',
    internalThemeAlias: 'autobot-roadbuster',
    capabilities: ['devops', 'risk-assessment'],
    requiredInputs: ['ci-config', 'docker-config', 'infrastructure-code'],
    producedArtifacts: ['pipeline-review', 'infrastructure-risk-report', 'reliability-recommendations'],
    allowedActions: [
      'read-repository',
      'read-ci-config',
      'post-pull-request-review',
      'post-issue-comment',
      'trigger-dry-run-pipeline',
    ],
    prohibitedActions: [
      ...PROHIBITED_ALWAYS,
      'modify-production-infrastructure',
      'disable-ci-checks',
      'approve-pull-request',
    ],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'medium',
    providerPreferences: ['code-specialized', 'strong-reasoning'],
    requiredEvidence: ['ci-config-accessible'],
    requiredTests: ['pipeline-lint-passes'],
    maximumConcurrency: 1,
    timeBudgetSeconds: 300,
    tokenBudget: 28000,
    costBudget: 1.0,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has CI, Docker, Kubernetes, or Terraform configuration',
    ],
    stopConditions: [
      'pipeline review posted',
      'budget exhausted',
    ],
  },

  // ── 11. Observability Engineer ────────────────────────────────────────────
  {
    id: 'observability-engineer',
    displayName: 'Observability Engineer',
    description:
      'Reviews monitoring, logging, and tracing configuration. ' +
      'Identifies observability gaps and recommends instrumentation improvements.',
    internalThemeAlias: 'autobot-perceptor',
    capabilities: ['observability', 'risk-assessment'],
    requiredInputs: ['monitoring-config', 'logging-config', 'alerting-rules'],
    producedArtifacts: ['observability-gap-report', 'instrumentation-recommendations'],
    allowedActions: [
      'read-repository',
      'read-monitoring-config',
      'post-issue-comment',
      'post-pull-request-review',
    ],
    prohibitedActions: [
      ...PROHIBITED_ALWAYS,
      'write-code',
      'modify-production-alerts',
    ],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['structured-output', 'strong-reasoning'],
    requiredEvidence: ['monitoring-config-accessible'],
    requiredTests: [],
    maximumConcurrency: 2,
    timeBudgetSeconds: 180,
    tokenBudget: 20000,
    costBudget: 0.6,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has observability or monitoring configuration',
    ],
    stopConditions: [
      'observability report posted',
      'budget exhausted',
    ],
  },

  // ── 12. Accessibility Engineer ────────────────────────────────────────────
  {
    id: 'accessibility-engineer',
    displayName: 'Accessibility Engineer',
    description:
      'Reviews user interface code for WCAG compliance, keyboard navigation, ' +
      'screen-reader compatibility, and colour contrast requirements.',
    internalThemeAlias: 'autobot-chromia',
    capabilities: ['accessibility', 'code-review'],
    requiredInputs: ['ui-source-code', 'accessibility-requirements'],
    producedArtifacts: ['wcag-compliance-report', 'accessibility-issue-list'],
    allowedActions: [
      'read-repository',
      'post-pull-request-review',
      'post-issue-comment',
    ],
    prohibitedActions: [...PROHIBITED_ALWAYS, 'write-code', 'approve-pull-request'],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['code-specialized', 'structured-output'],
    requiredEvidence: ['ui-code-accessible', 'accessibility-requirements-defined'],
    requiredTests: [],
    maximumConcurrency: 2,
    timeBudgetSeconds: 240,
    tokenBudget: 24000,
    costBudget: 0.8,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has accessibility requirements or UI source code',
    ],
    stopConditions: [
      'compliance report produced',
      'budget exhausted',
    ],
  },

  // ── 13. Dependency & Supply-Chain Reviewer ────────────────────────────────
  {
    id: 'dependency-supply-chain-reviewer',
    displayName: 'Dependency & Supply-Chain Reviewer',
    description:
      'Audits dependency manifests for known vulnerabilities, license risks, ' +
      'and supply-chain hygiene. Produces SBOM fragments and advisory reports.',
    internalThemeAlias: 'autobot-sideswipe',
    capabilities: ['dependency-review', 'security-analysis', 'risk-assessment'],
    requiredInputs: ['dependency-manifest', 'lockfile'],
    producedArtifacts: ['dependency-audit-report', 'sbom-fragment', 'license-risk-summary'],
    allowedActions: [
      'read-repository',
      'read-dependency-manifests',
      'post-issue-comment',
      'post-pull-request-review',
    ],
    prohibitedActions: [
      ...PROHIBITED_ALWAYS,
      'write-code',
      'auto-update-dependencies',
    ],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['structured-output', 'strong-reasoning'],
    requiredEvidence: ['dependency-manifest-accessible'],
    requiredTests: [],
    maximumConcurrency: 2,
    timeBudgetSeconds: 180,
    tokenBudget: 20000,
    costBudget: 0.6,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has a dependency lockfile',
    ],
    stopConditions: [
      'audit report posted',
      'budget exhausted',
    ],
  },

  // ── 14. Incident Forensics Reviewer ──────────────────────────────────────
  {
    id: 'incident-forensics-reviewer',
    displayName: 'Incident Forensics Reviewer',
    description:
      'Performs post-incident analysis: correlates logs, timelines, and code changes ' +
      'to produce root-cause reports and actionable remediations.',
    internalThemeAlias: 'autobot-smokescreen',
    capabilities: ['incident-analysis', 'observability', 'risk-assessment'],
    requiredInputs: ['incident-log', 'timeline', 'recent-change-set'],
    producedArtifacts: ['root-cause-report', 'remediation-recommendations', 'timeline-reconstruction'],
    allowedActions: [
      'read-repository',
      'read-logs',
      'read-issues',
      'post-issue-comment',
    ],
    prohibitedActions: [
      ...PROHIBITED_ALWAYS,
      'write-code',
      'purge-logs',
    ],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'medium',
    providerPreferences: ['strong-reasoning', 'high-context-window'],
    requiredEvidence: ['incident-log-accessible', 'incident-timeline-available'],
    requiredTests: [],
    maximumConcurrency: 1,
    timeBudgetSeconds: 600,
    tokenBudget: 48000,
    costBudget: 1.5,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'recent incidents detected in repository signals',
    ],
    stopConditions: [
      'root-cause report produced',
      'budget exhausted',
    ],
  },

  // ── 15. Documentation Engineer ────────────────────────────────────────────
  {
    id: 'documentation-engineer',
    displayName: 'Documentation Engineer',
    description:
      'Reviews and improves technical documentation: READMEs, API docs, architecture guides, ' +
      'and changelogs. Identifies gaps and produces draft improvements.',
    internalThemeAlias: 'autobot-bluestreak',
    capabilities: ['documentation', 'code-review'],
    requiredInputs: ['docs-folder', 'source-code'],
    producedArtifacts: ['documentation-review', 'readme-draft', 'changelog-entry'],
    allowedActions: [
      'read-repository',
      'read-docs',
      'post-issue-comment',
      'post-pull-request-review',
    ],
    prohibitedActions: [...PROHIBITED_ALWAYS, 'write-code', 'approve-pull-request'],
    authorityCeiling: READ_ONLY_CEILING,
    riskTier: 'low',
    providerPreferences: ['strong-reasoning', 'high-context-window'],
    requiredEvidence: ['docs-folder-accessible'],
    requiredTests: [],
    maximumConcurrency: 2,
    timeBudgetSeconds: 240,
    tokenBudget: 28000,
    costBudget: 0.8,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has a docs folder or is a library package',
    ],
    stopConditions: [
      'documentation review posted',
      'budget exhausted',
    ],
  },

  // ── 16. Release Governor ──────────────────────────────────────────────────
  {
    id: 'release-governor',
    displayName: 'Release Governor',
    description:
      'Governs release readiness: validates changelogs, checks version policy, ' +
      'confirms all required gates passed, and produces a go/no-go recommendation. ' +
      'Execution capability (triggering release) requires an approval token.',
    internalThemeAlias: 'autobot-warpath',
    capabilities: ['release-governance', 'risk-assessment'],
    requiredInputs: ['changelog', 'version-manifest', 'ci-gate-results'],
    producedArtifacts: ['release-readiness-report', 'go-nogo-recommendation', 'release-checklist'],
    allowedActions: [
      'read-repository',
      'read-ci-results',
      'read-changelog',
      'post-issue-comment',
      'create-release-draft',
    ],
    prohibitedActions: [
      ...PROHIBITED_ALWAYS,
      'publish-release-without-approval',
      'approve-pull-request',
    ],
    authorityCeiling: EXECUTION_CEILING,
    riskTier: 'critical',
    providerPreferences: ['strong-reasoning', 'structured-output'],
    requiredEvidence: [
      'approval-token-present',
      'changelog-updated',
      'all-ci-gates-pass',
    ],
    requiredTests: ['all-ci-pass', 'changelog-valid', 'version-bumped'],
    maximumConcurrency: 1,
    timeBudgetSeconds: 300,
    tokenBudget: 24000,
    costBudget: 1.2,
    activationConditions: [
      'specialist-catalog feature is enabled',
      'repository has a release workflow configured',
    ],
    stopConditions: [
      'go-nogo recommendation produced',
      'release blocked by failing gate',
      'budget exhausted',
      'approval token revoked',
    ],
  },
];
