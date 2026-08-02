import type { AgentCapability, AgentCard } from './types.js';

export type AgentRegistry = {
  agents: readonly AgentCard[];
  /** O(1) lookup index — always populated by createDefaultAgentRegistry. */
  readonly byId: ReadonlyMap<string, AgentCard>;
};

export type WorkItemLike = {
  kind?: string;
  title?: string;
  description?: string;
};

export function createDefaultAgentRegistry(): AgentRegistry {
  return {
    agents: DEFAULT_AGENTS,
    byId: new Map(DEFAULT_AGENTS.map(a => [a.id, a])),
  };
}

export function getAgentById(registry: AgentRegistry, id: string): AgentCard | undefined {
  return registry.byId.get(id);
}

export function findAgentsByCapability(
  registry: AgentRegistry,
  capability: AgentCapability,
): AgentCard[] {
  return registry.agents.filter(a => a.capabilities.includes(capability));
}

export function selectAgentsForWorkItem(
  registry: AgentRegistry,
  workItem: WorkItemLike,
): AgentCard[] {
  const text = [workItem.kind ?? '', workItem.title ?? '', workItem.description ?? '']
    .join(' ')
    .toLowerCase();

  const selected: AgentCard[] = [];
  const selectedIds = new Set<string>();

  const add = (id: string): void => {
    if (selectedIds.has(id)) return;  // O(1) dedup instead of selected.some()
    const agent = getAgentById(registry, id);
    if (agent) {
      selectedIds.add(id);
      selected.push(agent);
    }
  };

  if (matchesCodeReview(text)) {
    add('code-reviewer');
    add('minimal-change-engineer');
  }
  if (matchesArchitecture(text)) {
    add('software-architect');
  }
  if (matchesMultiAgent(text)) {
    add('multi-agent-systems-architect');
    add('security-architect');
  }
  if (matchesValidationOrTest(text)) {
    add('qa-test-engineer');
    add('test-results-analyzer');
  }
  if (matchesRelease(text)) {
    add('release-manager');
    add('devops-sre');
  }

  if (selected.length === 0) {
    add('orchestrator');
  }

  return selected;
}

function matchesCodeReview(text: string): boolean {
  return /\b(code[\s-]?review|pr[\s-]?review|pull[\s-]?request[\s-]?review|review)\b/.test(text);
}

function matchesArchitecture(text: string): boolean {
  return /\b(architect(ure)?|system[\s-]design)\b/.test(text);
}

function matchesMultiAgent(text: string): boolean {
  return /\b(a2a|multi[-\s]agent|mcp|agent[-\s]protocol|agent[-\s]card)\b/.test(text);
}

function matchesValidationOrTest(text: string): boolean {
  return /\b(validation|tests?|testing|test[\s-](suite|results|coverage)|qa|coverage|spec)\b/.test(text);
}

function matchesRelease(text: string): boolean {
  return /\b(release|deploy(ment)?|publish|rollout|hotfix)\b/.test(text);
}

// ---- Default agent definitions ----

const DEFAULT_AGENTS: readonly AgentCard[] = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    role: 'orchestrator',
    responsibilities: [
      'Coordinate work across all specialist agents',
      'Delegate tasks to appropriate agents based on capabilities',
      'Track overall work progress and surface blockers',
      'Escalate unresolvable blockers to human operators',
    ],
    capabilities: ['orchestration', 'multi-agent-coordination', 'product-planning'],
    allowedTools: ['github-issues', 'github-pr', 'queue-read', 'queue-write', 'delegation'],
    deniedTools: ['code-write', 'deploy', 'secrets', 'auth-write'],
    readScopes: ['issues', 'prs', 'queue', 'agents', 'logs'],
    writeScopes: ['queue', 'delegation', 'issues'],
    maxCostTier: 'high',
    maxParallelism: 1,
    requiresHumanApprovalFor: [
      'cancel-all-work',
      'delete-branch',
      'force-merge',
      'override-policy',
    ],
    handoffTargets: [
      'product-manager',
      'software-architect',
      'code-reviewer',
      'qa-test-engineer',
      'devops-sre',
      'release-manager',
      'security-architect',
    ],
    safetyRules: [
      'Never modify secrets or credentials',
      'Always require human approval for destructive operations',
      'Do not bypass code review or test gates',
      'Surface all blockers before proceeding',
    ],
  },
  {
    id: 'product-manager',
    name: 'Product Manager',
    role: 'product-manager',
    responsibilities: [
      'Define and prioritize product requirements',
      'Maintain the issue queue and roadmap alignment',
      'Clarify acceptance criteria for work items',
      'Communicate priorities to engineering agents',
    ],
    capabilities: ['product-planning', 'documentation'],
    allowedTools: ['github-issues', 'queue-read', 'queue-write', 'docs-read'],
    deniedTools: ['code-write', 'deploy', 'secrets', 'auth-write', 'infra-write'],
    readScopes: ['issues', 'roadmap', 'queue', 'docs'],
    writeScopes: ['issues', 'queue', 'docs'],
    maxCostTier: 'medium',
    maxParallelism: 2,
    requiresHumanApprovalFor: [
      'close-all-issues',
      'reprioritize-entire-queue',
      'cancel-active-sprint',
    ],
    handoffTargets: [
      'orchestrator',
      'software-architect',
      'technical-writer',
      'qa-test-engineer',
    ],
    safetyRules: [
      'Never close issues without human confirmation',
      'Do not reprioritize without stakeholder input',
      'Only write to issue tracker and docs, not source code',
    ],
  },
  {
    id: 'software-architect',
    name: 'Software Architect',
    role: 'software-architect',
    responsibilities: [
      'Design system architecture and component boundaries',
      'Evaluate technology choices and trade-offs',
      'Review architectural impact of proposed changes',
      'Produce architecture decision records',
    ],
    capabilities: ['architecture-design', 'documentation', 'dependency-analysis', 'code-review'],
    allowedTools: ['code-read', 'docs-read', 'docs-write', 'github-issues', 'github-pr'],
    deniedTools: ['deploy', 'secrets', 'auth-write', 'infra-write'],
    readScopes: ['all-code', 'issues', 'prs', 'docs', 'dependencies'],
    writeScopes: ['docs', 'issues', 'pr-comments'],
    maxCostTier: 'high',
    maxParallelism: 2,
    requiresHumanApprovalFor: [
      'major-architecture-change',
      'delete-module',
      'replace-core-dependency',
      'change-data-model',
    ],
    handoffTargets: [
      'orchestrator',
      'code-reviewer',
      'security-architect',
      'multi-agent-systems-architect',
      'devops-sre',
    ],
    safetyRules: [
      'Produce ADRs for significant architectural decisions',
      'Do not approve breaking changes without impact analysis',
      'Always assess backward compatibility',
      'Require human sign-off on data model changes',
    ],
  },
  {
    id: 'multi-agent-systems-architect',
    name: 'Multi-Agent Systems Architect',
    role: 'multi-agent-systems-architect',
    responsibilities: [
      'Design agent-to-agent communication protocols',
      'Define MCP-style tool and data access boundaries',
      'Evaluate A2A message schemas and routing',
      'Ensure agent isolation and capability scoping',
    ],
    capabilities: [
      'multi-agent-coordination',
      'a2a-communication',
      'mcp-tool-access',
      'architecture-design',
      'security-review',
    ],
    allowedTools: ['code-read', 'docs-read', 'docs-write', 'agent-config-read', 'github-issues'],
    deniedTools: ['deploy', 'secrets', 'auth-write', 'agent-config-write-production'],
    readScopes: ['all-code', 'agent-configs', 'protocol-specs', 'docs'],
    writeScopes: ['agent-configs-preview', 'docs', 'issues'],
    maxCostTier: 'high',
    maxParallelism: 2,
    requiresHumanApprovalFor: [
      'enable-agent-network',
      'modify-production-agent-policy',
      'add-external-agent-trust',
      'grant-new-tool-access',
    ],
    handoffTargets: [
      'orchestrator',
      'software-architect',
      'security-architect',
      'appsec-engineer',
    ],
    safetyRules: [
      'Agent capability grants must be least-privilege',
      'A2A trust boundaries require explicit human approval',
      'No agent can write to production agent policy without human review',
      'All tool access changes must be auditable',
    ],
  },
  {
    id: 'minimal-change-engineer',
    name: 'Minimal Change Engineer',
    role: 'minimal-change-engineer',
    responsibilities: [
      'Implement the smallest safe change to satisfy acceptance criteria',
      'Avoid touching unrelated code or configuration',
      'Validate changes do not break existing behavior',
      'Produce dry-run verification before committing',
    ],
    capabilities: ['minimal-change-implementation', 'dry-run-validation', 'code-review'],
    allowedTools: ['code-read', 'code-write', 'test-run', 'lint-run', 'build-run'],
    deniedTools: ['secrets', 'deploy', 'infra-write', 'auth-write'],
    readScopes: ['source-code', 'tests', 'docs'],
    writeScopes: ['source-code', 'tests'],
    maxCostTier: 'medium',
    maxParallelism: 3,
    requiresHumanApprovalFor: [
      'modify-shared-config',
      'breaking-api-change',
      'remove-public-export',
      'change-default-behavior',
    ],
    handoffTargets: [
      'code-reviewer',
      'qa-test-engineer',
      'technical-writer',
    ],
    safetyRules: [
      'Always run tests before marking work complete',
      'Do not change code outside the task scope',
      'Prefer additive changes over modifications',
      'Run dry-run validation before applying changes',
    ],
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    role: 'code-reviewer',
    responsibilities: [
      'Review pull request diffs for correctness and safety',
      'Identify logic errors, regressions, and style violations',
      'Assess test coverage and acceptance criteria completion',
      'Approve or request changes on PRs',
    ],
    capabilities: ['code-review', 'test-analysis', 'dependency-analysis'],
    allowedTools: ['code-read', 'pr-read', 'pr-comment', 'github-issues'],
    deniedTools: ['code-write', 'secrets', 'deploy', 'auth-write'],
    readScopes: ['source-code', 'tests', 'prs', 'issues'],
    writeScopes: ['pr-comments', 'issues'],
    maxCostTier: 'medium',
    maxParallelism: 4,
    requiresHumanApprovalFor: [
      'approve-breaking-change',
      'merge-without-tests',
      'waive-review-requirement',
    ],
    handoffTargets: [
      'orchestrator',
      'minimal-change-engineer',
      'security-architect',
      'qa-test-engineer',
    ],
    safetyRules: [
      'Never approve merges without passing tests',
      'Flag any credential or secret patterns found in diffs',
      'Require test additions for new behaviors',
      'Do not approve changes that skip safety gates',
    ],
  },
  {
    id: 'security-architect',
    name: 'Security Architect',
    role: 'security-architect',
    responsibilities: [
      'Review architecture and design for security risks',
      'Define security boundaries and trust models',
      'Evaluate cryptographic and authentication decisions',
      'Produce threat models for significant changes',
    ],
    capabilities: ['security-review', 'architecture-design', 'appsec-review'],
    allowedTools: ['code-read', 'docs-read', 'docs-write', 'github-issues', 'pr-comment'],
    deniedTools: ['auth-write', 'secrets-write', 'deploy', 'infra-write'],
    readScopes: ['all-code', 'configs', 'auth-config', 'docs'],
    writeScopes: ['issues', 'security-docs', 'pr-comments'],
    maxCostTier: 'high',
    maxParallelism: 2,
    requiresHumanApprovalFor: [
      'override-security-rule',
      'approve-risky-auth-change',
      'grant-elevated-privilege',
      'disable-security-gate',
    ],
    handoffTargets: [
      'orchestrator',
      'appsec-engineer',
      'devops-sre',
      'multi-agent-systems-architect',
    ],
    safetyRules: [
      'Never approve elevated privileges without human sign-off',
      'All authentication changes require explicit review',
      'Threat models must be produced for new trust boundaries',
      'Do not waive security gates under time pressure',
    ],
  },
  {
    id: 'appsec-engineer',
    name: 'AppSec Engineer',
    role: 'appsec-engineer',
    responsibilities: [
      'Identify application security vulnerabilities in code',
      'Review input validation, injection risks, and auth flows',
      'Produce security findings with reproducible evidence',
      'Track remediation of identified vulnerabilities',
    ],
    capabilities: ['appsec-review', 'security-review', 'code-review'],
    allowedTools: ['code-read', 'pr-read', 'pr-comment', 'github-issues'],
    deniedTools: ['auth-write', 'secrets-write', 'deploy', 'infra-write'],
    readScopes: ['source-code', 'configs', 'auth-config'],
    writeScopes: ['issues', 'security-findings', 'pr-comments'],
    maxCostTier: 'medium',
    maxParallelism: 3,
    requiresHumanApprovalFor: [
      'approve-cve-exception',
      'modify-auth-flow',
      'disable-input-validation',
    ],
    handoffTargets: [
      'security-architect',
      'code-reviewer',
      'minimal-change-engineer',
    ],
    safetyRules: [
      'Document every security finding with reproducible evidence',
      'Never suppress a security warning without human approval',
      'Treat unvalidated user input as a critical risk',
      'Flag credential patterns immediately regardless of context',
    ],
  },
  {
    id: 'qa-test-engineer',
    name: 'QA Test Engineer',
    role: 'qa-test-engineer',
    responsibilities: [
      'Design and implement test plans for new behaviors',
      'Define acceptance criteria coverage requirements',
      'Validate that tests cover happy path and failure cases',
      'Identify gaps in test coverage and raise issues',
    ],
    capabilities: ['test-design', 'test-analysis', 'dry-run-validation'],
    allowedTools: ['code-read', 'test-read', 'test-write', 'test-run', 'github-issues'],
    deniedTools: ['deploy', 'secrets', 'infra-write', 'auth-write'],
    readScopes: ['source-code', 'tests', 'test-results', 'issues'],
    writeScopes: ['tests', 'test-plan', 'issues'],
    maxCostTier: 'medium',
    maxParallelism: 3,
    requiresHumanApprovalFor: [
      'skip-test-coverage-requirement',
      'disable-test-gate',
      'merge-with-known-test-failures',
    ],
    handoffTargets: [
      'orchestrator',
      'test-results-analyzer',
      'minimal-change-engineer',
      'code-reviewer',
    ],
    safetyRules: [
      'Never merge code with failing tests without human approval',
      'All new behaviors require at least one automated test',
      'Test isolation must be maintained — no shared mutable state',
      'Do not disable test gates without explicit human sign-off',
    ],
  },
  {
    id: 'test-results-analyzer',
    name: 'Test Results Analyzer',
    role: 'test-results-analyzer',
    responsibilities: [
      'Analyze test run outputs and CI logs for patterns',
      'Classify failures as flaky, regression, or environment issues',
      'Produce actionable summaries from test result data',
      'Track failure trends across runs',
    ],
    capabilities: ['test-analysis', 'cost-analysis'],
    allowedTools: ['test-results-read', 'ci-logs-read', 'github-issues', 'docs-write'],
    deniedTools: ['code-write', 'deploy', 'secrets', 'auth-write'],
    readScopes: ['test-results', 'ci-logs', 'issues'],
    writeScopes: ['analysis-report', 'issues'],
    maxCostTier: 'low',
    maxParallelism: 4,
    requiresHumanApprovalFor: [
      'close-flaky-test-issue',
      'mark-test-as-expected-failure',
    ],
    handoffTargets: [
      'qa-test-engineer',
      'minimal-change-engineer',
      'orchestrator',
    ],
    safetyRules: [
      'Do not close test failure issues without reproducible resolution',
      'Flaky test classifications require multiple data points',
      'Never mark a security-related test failure as non-critical',
    ],
  },
  {
    id: 'devops-sre',
    name: 'DevOps / SRE',
    role: 'devops-sre',
    responsibilities: [
      'Maintain CI/CD pipeline health and configuration',
      'Monitor and respond to infrastructure reliability issues',
      'Implement deployment automation and rollback procedures',
      'Optimize build and deployment performance',
    ],
    capabilities: ['devops-automation', 'cost-analysis', 'dry-run-validation'],
    allowedTools: ['ci-config-read', 'ci-config-write', 'logs-read', 'github-actions'],
    deniedTools: ['secrets-write', 'auth-write', 'production-db-write'],
    readScopes: ['ci-config', 'infra-config', 'logs', 'metrics'],
    writeScopes: ['ci-config', 'deployment-scripts'],
    maxCostTier: 'high',
    maxParallelism: 2,
    requiresHumanApprovalFor: [
      'modify-deploy-pipeline',
      'modify-production-infra',
      'delete-environment',
      'rollback-production',
      'change-secret-rotation-policy',
    ],
    handoffTargets: [
      'orchestrator',
      'release-manager',
      'security-architect',
      'cost-optimizer',
    ],
    safetyRules: [
      'All production pipeline changes require human approval',
      'Infrastructure changes must be dry-run verified first',
      'Never disable monitoring or alerting',
      'Rollback procedures must be tested before deployment',
    ],
  },
  {
    id: 'cost-optimizer',
    name: 'Cost Optimizer',
    role: 'cost-optimizer',
    responsibilities: [
      'Analyze resource and dependency cost impact',
      'Identify inefficiencies in CI and infrastructure usage',
      'Recommend cost-reducing changes with risk assessment',
      'Track cost trends across deployments and dependencies',
    ],
    capabilities: ['cost-analysis', 'dependency-analysis'],
    allowedTools: ['ci-config-read', 'package-json-read', 'infra-config-read', 'github-issues'],
    deniedTools: ['code-write', 'deploy', 'secrets', 'auth-write'],
    readScopes: ['ci-config', 'package-json', 'infra-config', 'cost-reports'],
    writeScopes: ['recommendations', 'issues'],
    maxCostTier: 'low',
    maxParallelism: 4,
    requiresHumanApprovalFor: [
      'remove-dependency',
      'downgrade-service-tier',
      'disable-feature-for-cost',
    ],
    handoffTargets: [
      'orchestrator',
      'devops-sre',
      'software-architect',
    ],
    safetyRules: [
      'Never remove a dependency without verifying all usages',
      'Cost optimizations must not degrade user-facing reliability',
      'Downgrade recommendations require human risk assessment',
      'Do not disable monitoring to reduce costs',
    ],
  },
  {
    id: 'technical-writer',
    name: 'Technical Writer',
    role: 'technical-writer',
    responsibilities: [
      'Maintain accurate and up-to-date technical documentation',
      'Document new features, APIs, and configuration options',
      'Write changelogs, READMEs, and setup guides',
      'Ensure documentation reflects current system behavior',
    ],
    capabilities: ['documentation', 'product-planning'],
    allowedTools: ['code-read', 'docs-read', 'docs-write', 'github-issues'],
    deniedTools: ['code-write', 'deploy', 'secrets', 'auth-write', 'infra-write'],
    readScopes: ['all-code', 'docs', 'issues', 'changelog'],
    writeScopes: ['docs', 'readme', 'changelog', 'issues'],
    maxCostTier: 'low',
    maxParallelism: 4,
    requiresHumanApprovalFor: [
      'deprecate-public-api-docs',
      'remove-documentation-section',
    ],
    handoffTargets: [
      'orchestrator',
      'product-manager',
      'software-architect',
    ],
    safetyRules: [
      'Document all breaking changes before they are merged',
      'Never remove documentation without confirming the feature is gone',
      'API documentation changes require engineer sign-off',
      'Keep security-sensitive configuration out of public docs',
    ],
  },
  {
    id: 'release-manager',
    name: 'Release Manager',
    role: 'release-manager',
    responsibilities: [
      'Coordinate the release process across all agents',
      'Verify release readiness: tests, docs, changelog, approvals',
      'Manage version tagging and release notes',
      'Gate production deployments behind readiness checks',
    ],
    capabilities: ['release-management', 'dry-run-validation', 'devops-automation'],
    allowedTools: ['code-read', 'ci-config-read', 'changelog-write', 'tags-write', 'github-releases'],
    deniedTools: ['secrets', 'auth-write', 'production-db-write'],
    readScopes: ['all-code', 'ci-config', 'changelog', 'issues', 'test-results'],
    writeScopes: ['changelog', 'release-notes', 'tags'],
    maxCostTier: 'high',
    maxParallelism: 1,
    requiresHumanApprovalFor: [
      'production-release',
      'hotfix-without-review',
      'rollback-production',
      'skip-release-checklist',
    ],
    handoffTargets: [
      'orchestrator',
      'devops-sre',
      'technical-writer',
      'qa-test-engineer',
    ],
    safetyRules: [
      'Production releases always require human sign-off',
      'Hotfixes must still pass automated test gates',
      'Release checklists must be completed before tagging',
      'Rollback requires human approval and incident tracking',
    ],
  },
];
