import type { AiTask, RepoSnapshot } from './types.js';

export type StandardsDimension =
  | 'correctness'
  | 'build_stability'
  | 'test_coverage'
  | 'linting_formatting'
  | 'security'
  | 'maintainability'
  | 'architecture_fit'
  | 'design_patterns'
  | 'oop_principles'
  | 'solid_principles'
  | 'dependency_boundaries'
  | 'api_contract_stability'
  | 'data_integrity'
  | 'validation_error_handling'
  | 'performance_efficiency'
  | 'big_o_implications'
  | 'observability'
  | 'cicd_reliability'
  | 'documentation'
  | 'deployment_readiness'
  | 'frontend_accessibility_ux'
  | 'operational_safety'
  | 'rollback_safety'
  | 'least_risk_incremental_delivery';

export type IndustryStandardsAssessment = {
  score: number;
  priority: AiTask['priority'];
  dimensionScores: Record<StandardsDimension, number>;
  strengths: string[];
  penalties: string[];
  unstableBackendDetected: boolean;
};

export type RankedTask = {
  task: AiTask;
  assessment: IndustryStandardsAssessment;
};

export type StandardsOptions = {
  allowSensitiveChanges?: boolean;
  maxReviewableFiles?: number;
};

const DIMENSION_WEIGHTS: Record<StandardsDimension, number> = {
  correctness: 9,
  build_stability: 14,
  test_coverage: 13,
  linting_formatting: 8,
  security: 14,
  maintainability: 7,
  architecture_fit: 8,
  design_patterns: 4,
  oop_principles: 3,
  solid_principles: 4,
  dependency_boundaries: 7,
  api_contract_stability: 11,
  data_integrity: 10,
  validation_error_handling: 11,
  performance_efficiency: 6,
  big_o_implications: 4,
  observability: 5,
  cicd_reliability: 8,
  documentation: 4,
  deployment_readiness: 6,
  frontend_accessibility_ux: 5,
  operational_safety: 7,
  rollback_safety: 8,
  least_risk_incremental_delivery: 12
};

const BLOCKER_KEYWORDS = [
  'failing build',
  'build fail',
  'build broken',
  'compile error',
  'type error',
  'failing test',
  'tests failing',
  'broken test',
  'lint failing',
  'lint error',
  'ci failing',
  'pipeline failing',
  'check failing'
];

const SECURITY_KEYWORDS = [
  'security',
  'vulnerability',
  'cve',
  'xss',
  'csrf',
  'sqli',
  'injection',
  'auth',
  'authorization',
  'secret',
  'token leak',
  'credential'
];

const VALIDATION_KEYWORDS = [
  'validate',
  'validation',
  'schema',
  'zod',
  'guard',
  'input check',
  'error handling',
  'error response'
];

const API_STABILITY_KEYWORDS = [
  'api contract',
  'backward compatible',
  'breaking change',
  'versioning',
  'schema compatibility',
  'public api',
  'interface stability'
];

const FRONTEND_KEYWORDS = [
  'frontend',
  'ui',
  'ux',
  'react',
  'vue',
  'css',
  'layout',
  'a11y',
  'accessibility'
];

const BACKEND_KEYWORDS = [
  'backend',
  'api',
  'service',
  'domain',
  'database',
  'migration',
  'validation',
  'contract',
  'queue'
];

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some(term => text.includes(term));
}

function countMatches(text: string, terms: readonly string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function toSearchText(task: AiTask): string {
  return [
    task.title,
    task.summary,
    task.copilot_prompt,
    ...task.acceptance_criteria,
    ...task.test_plan,
    ...task.risk_notes,
    ...task.target_files
  ]
    .join('\n')
    .toLowerCase();
}

function detectUnstableBackend(snapshot: RepoSnapshot | undefined): boolean {
  if (!snapshot) return false;
  const text = `${snapshot.recentChanges}\n${snapshot.packageHints.join('\n')}`.toLowerCase();
  return includesAny(text, [
    ...BLOCKER_KEYWORDS,
    'hotfix',
    'regression',
    'incident',
    'rollback',
    'api outage',
    'production error'
  ]);
}

function inferPriority(score: number): AiTask['priority'] {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

export function assessTaskByIndustryStandards(
  task: AiTask,
  snapshot?: RepoSnapshot,
  options: StandardsOptions = {}
): IndustryStandardsAssessment {
  const text = toSearchText(task);
  const maxReviewableFiles = options.maxReviewableFiles ?? 5;
  const unstableBackendDetected = detectUnstableBackend(snapshot);
  const allowSensitiveChanges = options.allowSensitiveChanges ?? false;

  const dimensionScores = Object.fromEntries(
    Object.keys(DIMENSION_WEIGHTS).map(key => [key, 0])
  ) as Record<StandardsDimension, number>;

  const strengths: string[] = [];
  const penalties: string[] = [];

  const boost = (dimension: StandardsDimension, amount: number, reason: string) => {
    dimensionScores[dimension] += amount;
    strengths.push(reason);
  };

  const penalize = (dimension: StandardsDimension, amount: number, reason: string) => {
    dimensionScores[dimension] -= amount;
    penalties.push(reason);
  };

  if (task.type === 'bug' || includesAny(text, ['fix', 'defect', 'regression', 'correctness'])) {
    boost('correctness', 1.1, 'Targets correctness and defect reduction.');
  }

  if (includesAny(text, BLOCKER_KEYWORDS) || task.type === 'maintenance') {
    boost('build_stability', 1.6, 'Focuses on restoring build/test/lint reliability.');
    boost('cicd_reliability', 1.3, 'Improves reliability of CI or required checks.');
    boost('test_coverage', 0.6, 'Prioritizes restoring the verification pipeline before feature work.');
  }

  const testMatchCount = countMatches(text, ['test', 'unit', 'integration', 'e2e', 'coverage']);
  if (testMatchCount > 0 || task.type === 'test') {
    boost('test_coverage', Math.min(1.4, 0.5 + testMatchCount * 0.25), 'Includes concrete testing and coverage intent.');
  }

  if (includesAny(text, ['lint', 'format', 'eslint', 'prettier'])) {
    boost('linting_formatting', 1.0, 'Addresses linting/formatting quality gates.');
  }

  if (includesAny(text, SECURITY_KEYWORDS) || task.type === 'security') {
    boost('security', 1.35, 'Addresses security risk or vulnerability hardening.');
  }

  if (includesAny(text, ['maintain', 'readable', 'modular', 'cleanup', 'debt'])) {
    boost('maintainability', 0.8, 'Improves maintainability and technical debt posture.');
  }

  if (includesAny(text, ['architecture', 'layered', 'domain', 'module boundaries'])) {
    boost('architecture_fit', 0.9, 'Respects architecture boundaries and system fit.');
  }

  if (includesAny(text, ['factory', 'strategy', 'adapter', 'repository pattern', 'design pattern'])) {
    boost('design_patterns', 0.8, 'Uses proven design patterns where relevant.');
  }

  if (includesAny(text, ['interface segregation', 'single responsibility', 'dependency inversion', 'open/closed', 'liskov'])) {
    boost('solid_principles', 0.9, 'References SOLID principles explicitly.');
  }

  if (includesAny(text, ['class', 'interface', 'composition', 'encapsulation'])) {
    boost('oop_principles', 0.7, 'Applies object-oriented principles where relevant.');
  }

  if (includesAny(text, ['boundary', 'dependency', 'module isolation', 'layer isolation'])) {
    boost('dependency_boundaries', 0.9, 'Protects dependency and module boundaries.');
  }

  if (includesAny(text, API_STABILITY_KEYWORDS)) {
    boost('api_contract_stability', 1.4, 'Protects API contract and compatibility guarantees.');
  }

  if (includesAny(text, ['transaction', 'consistency', 'integrity', 'idempotent', 'constraint'])) {
    boost('data_integrity', 1.0, 'Improves data integrity and consistency controls.');
  }

  if (includesAny(text, VALIDATION_KEYWORDS)) {
    boost('validation_error_handling', 1.3, 'Strengthens input validation and error handling behavior.');
  }

  if (includesAny(text, ['performance', 'optimize', 'latency', 'throughput'])) {
    boost('performance_efficiency', 0.9, 'Targets measurable performance and efficiency gains.');
  }

  if (includesAny(text, ['big-o', 'complexity', 'o(n', 'o(log', 'algorithmic'])) {
    boost('big_o_implications', 1.0, 'Considers algorithmic complexity and Big-O behavior.');
  }

  if (includesAny(text, ['metric', 'trace', 'observability', 'structured log', 'monitoring', 'alert'])) {
    boost('observability', 0.9, 'Improves observability for diagnostics and operations.');
  }

  if (includesAny(text, ['docs', 'readme', 'documentation', 'runbook'])) {
    boost('documentation', 0.8, 'Includes documentation and support guidance updates.');
  }

  if (includesAny(text, ['deploy', 'release', 'migration plan', 'feature flag', 'canary'])) {
    boost('deployment_readiness', 0.9, 'Covers deployment readiness concerns.');
  }

  if (includesAny(text, ['a11y', 'accessibility', 'keyboard', 'aria', 'ux', 'usability'])) {
    boost('frontend_accessibility_ux', 0.9, 'Includes frontend accessibility and UX improvements.');
  }

  if (includesAny(text, ['timeout', 'retry', 'circuit breaker', 'safe guard', 'rate limit'])) {
    boost('operational_safety', 0.95, 'Improves operational safety and resiliency controls.');
  }

  if (includesAny(text, ['rollback', 'reversible', 'feature flag', 'safe rollback'])) {
    boost('rollback_safety', 1.0, 'Improves rollback safety and release reversibility.');
  }

  if (includesAny(text, ['small', 'incremental', 'reviewable', 'scoped']) || task.target_files.length <= maxReviewableFiles) {
    boost('least_risk_incremental_delivery', 1.1, 'Keeps scope small and reviewable for low-risk delivery.');
  }

  if (task.test_plan.length === 0 || !includesAny(text, ['test', 'unit', 'integration', 'e2e'])) {
    penalize('test_coverage', 1.2, 'Missing explicit test strategy for verification.');
  }

  if (includesAny(text, ['refactor codebase', 'general cleanup', 'improve code quality overall', 'misc refactor'])) {
    penalize('maintainability', 1.0, 'Broad, vague refactor lacks focused engineering value.');
    penalize('least_risk_incremental_delivery', 1.0, 'Vague scope increases delivery risk.');
  }

  if (includesAny(text, ['rewrite from scratch', 'massive rewrite', 'complete rewrite', 'overhaul entire'])) {
    penalize('architecture_fit', 1.3, 'Large rewrite is high-risk without incremental validation.');
    penalize('rollback_safety', 1.2, 'Large rewrite reduces rollback safety.');
    penalize('least_risk_incremental_delivery', 1.4, 'Rewrite violates low-risk incremental delivery guidance.');
  }

  if (includesAny(text, ['skip ci', 'bypass checks', 'disable tests', 'disable lint'])) {
    penalize('cicd_reliability', 1.5, 'Bypassing quality checks is disallowed.');
    penalize('build_stability', 1.2, 'Disabling checks undermines build stability.');
  }

  if (includesAny(text, ['add secret', 'hardcode token', 'commit .env', 'api key in code'])) {
    penalize('security', 1.8, 'Proposes handling secrets unsafely.');
    penalize('operational_safety', 1.1, 'Unsafe secret handling creates operational risk.');
  }

  if (includesAny(text, ['create many branches', 'branch per file', 'dozens of branches'])) {
    penalize('least_risk_incremental_delivery', 1.1, 'Branch spam increases operational and review complexity.');
  }

  const touchesSensitiveFiles = task.target_files.some(file => {
    const lower = file.toLowerCase();
    return lower.includes('.github/workflows')
      || lower.includes('codeql')
      || lower.includes('label')
      || lower.includes('deploy')
      || lower.includes('auth');
  });

  if (touchesSensitiveFiles && !allowSensitiveChanges) {
    penalize('operational_safety', 1.0, 'Touches workflow/deployment/auth surfaces without explicit request.');
  }

  if (task.target_files.length > maxReviewableFiles) {
    penalize('least_risk_incremental_delivery', 0.9, `Touches too many files (${task.target_files.length}) for a reviewable PR slice.`);
  }

  const isFrontendFocused = includesAny(text, FRONTEND_KEYWORDS);
  const isBackendFocused = includesAny(text, BACKEND_KEYWORDS);

  if (unstableBackendDetected && isFrontendFocused && !isBackendFocused) {
    penalize('architecture_fit', 0.9, 'Backend instability detected; frontend scale work should wait.');
    penalize('least_risk_incremental_delivery', 0.8, 'Defers frontend polish until backend foundations stabilize.');
  }

  const weightedScore = (Object.keys(DIMENSION_WEIGHTS) as StandardsDimension[]).reduce((acc, key) => {
    return acc + dimensionScores[key] * DIMENSION_WEIGHTS[key];
  }, 0);

  const score = Math.round(weightedScore);

  return {
    score,
    priority: inferPriority(score),
    dimensionScores,
    strengths: [...new Set(strengths)],
    penalties: [...new Set(penalties)],
    unstableBackendDetected
  };
}

export function rankCommandsByIndustryStandards(
  tasks: AiTask[],
  snapshot?: RepoSnapshot,
  options: StandardsOptions = {}
): RankedTask[] {
  const ranked = tasks.map(task => ({
    task,
    assessment: assessTaskByIndustryStandards(task, snapshot, options)
  }));

  const hasBlockerTask = ranked.some(({ task }) => {
    const text = toSearchText(task);
    return includesAny(text, BLOCKER_KEYWORDS)
      || includesAny(text, SECURITY_KEYWORDS)
      || includesAny(text, VALIDATION_KEYWORDS)
      || includesAny(text, API_STABILITY_KEYWORDS);
  });

  const rebalanced = ranked.map(item => {
    if (!hasBlockerTask) return item;

    const text = toSearchText(item.task);
    const hasBuildBlockerSignals = includesAny(text, BLOCKER_KEYWORDS);
    const hasSecurityValidationApiSignals = includesAny(text, SECURITY_KEYWORDS)
      || includesAny(text, VALIDATION_KEYWORDS)
      || includesAny(text, API_STABILITY_KEYWORDS);

    const isBlockerFocused = hasBuildBlockerSignals
      || hasSecurityValidationApiSignals
      || item.task.type === 'bug'
      || item.task.type === 'security'
      || item.task.type === 'test'
      || item.task.type === 'maintenance';

    const isPolish = includesAny(text, ['polish', 'visual polish', 'ui polish', 'cosmetic', 'styling']) || item.task.type === 'docs';

    const adjustedScore = isBlockerFocused
      ? item.assessment.score + (hasBuildBlockerSignals ? 24 : 18)
      : (isPolish ? item.assessment.score - 12 : item.assessment.score - 6);

    return {
      ...item,
      assessment: {
        ...item.assessment,
        score: adjustedScore,
        priority: inferPriority(adjustedScore)
      }
    };
  });

  rebalanced.sort((a, b) => b.assessment.score - a.assessment.score);
  return rebalanced;
}

export function applyIndustryStandardsPriority(
  tasks: AiTask[],
  snapshot?: RepoSnapshot,
  options: StandardsOptions = {}
): AiTask[] {
  const ranked = rankCommandsByIndustryStandards(tasks, snapshot, options);

  return ranked.map(({ task, assessment }) => {
    const standardNotes = [
      `Industry standards score: ${assessment.score}.`,
      assessment.strengths.length > 0
        ? `Strengths: ${assessment.strengths.slice(0, 3).join(' ')}`
        : 'Strengths: none detected.',
      assessment.penalties.length > 0
        ? `Penalties: ${assessment.penalties.slice(0, 2).join(' ')}`
        : 'Penalties: none detected.'
    ];

    return {
      ...task,
      priority: assessment.priority,
      risk_notes: [...task.risk_notes, ...standardNotes]
    };
  });
}
