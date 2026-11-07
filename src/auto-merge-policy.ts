export const AUTO_MERGE_POLICY_LABEL = 'auto-merge';

export const AUTO_MERGE_DENY_LABELS = [
  'security',
  'breaking-change',
  'do-not-merge',
  'no-auto-merge',
] as const;

export const AUTO_MERGE_APPROVED_BOT_AUTHORS = [
  'dependabot[bot]',
  'renovate[bot]',
] as const;

export const AUTO_MERGE_REQUIRED_CHECKS = [
  'test-and-build',
  'Analyze (javascript-typescript)',
] as const;

export type AutoMergePolicyInput = {
  number?: number;
  url?: string;
  author: { login: string };
  headCommitAuthor?: { login: string };
  isDraft: boolean;
  state?: string;
  baseRefName?: string;
  headRefName?: string;
  headSha?: string;
  changedFileCount?: number;
  files?: readonly string[];
  checks?: readonly {
    name: string;
    status: string;
    conclusion: string | null;
    headSha: string;
  }[];
  labels: readonly { name: string }[];
  reviews?: readonly { login: string; state: string }[];
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  dependencyUpdateType?: string | null;
  dependencyType?: string | null;
  autoMergeEnabled?: boolean;
};

type ValidatedAutoMergePolicyInput = AutoMergePolicyInput & {
  number: number;
  url: string;
  headCommitAuthor: { login: string };
  state: string;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  changedFileCount: number;
  files: readonly string[];
  checks: NonNullable<AutoMergePolicyInput['checks']>;
  reviews: NonNullable<AutoMergePolicyInput['reviews']>;
  dependencyUpdateType: string | null;
  dependencyType: string | null;
  autoMergeEnabled: boolean;
};

export type AutoMergePolicyOptions = {
  requirePolicyLabel?: boolean;
  policyLabel?: string;
  requireDependencyUpdateType?: boolean;
  /** @deprecated The allowlist is fixed in policy code and caller overrides are ignored. */
  approvedBotAuthors?: readonly string[];
};

export type AutoMergePolicyGate = {
  name: string;
  allowed: boolean;
  detail: string;
};

export type AutoMergePolicyEvaluation = {
  allowed: boolean;
  doArm: boolean;
  blockers: string[];
  gates: AutoMergePolicyGate[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isLogin(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]+(?:\[bot\])?$/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isNamedArray(value: unknown): value is Array<{ name: string }> {
  return Array.isArray(value) && value.every(item => isRecord(item) && isNonEmptyString(item.name));
}

function isCheckArray(value: unknown): value is NonNullable<AutoMergePolicyInput['checks']> {
  return Array.isArray(value) && value.every(item =>
    isRecord(item)
      && isNonEmptyString(item.name)
      && isNonEmptyString(item.status)
      && (item.conclusion === null || typeof item.conclusion === 'string')
      && isNonEmptyString(item.headSha));
}

function isReviewArray(value: unknown): value is NonNullable<AutoMergePolicyInput['reviews']> {
  return Array.isArray(value) && value.every(item =>
    isRecord(item) && isLogin(item.login) && isNonEmptyString(item.state));
}

function isPolicyInput(value: unknown): value is ValidatedAutoMergePolicyInput {
  if (!isRecord(value) || !isRecord(value.author) || !isRecord(value.headCommitAuthor)) {
    return false;
  }

  return Number.isSafeInteger(value.number)
    && (value.number as number) > 0
    && isNonEmptyString(value.url)
    && isLogin(value.author.login)
    && isLogin(value.headCommitAuthor.login)
    && typeof value.isDraft === 'boolean'
    && isNonEmptyString(value.state)
    && isNonEmptyString(value.baseRefName)
    && isNonEmptyString(value.headRefName)
    && /^[0-9a-f]{40}$/.test(String(value.headSha))
    && Number.isSafeInteger(value.changedFileCount)
    && (value.changedFileCount as number) >= 0
    && isStringArray(value.files)
    && isCheckArray(value.checks)
    && isNamedArray(value.labels)
    && isReviewArray(value.reviews)
    && (value.reviewDecision === null || typeof value.reviewDecision === 'string')
    && (value.mergeStateStatus === null || typeof value.mergeStateStatus === 'string')
    && (value.dependencyUpdateType === null || typeof value.dependencyUpdateType === 'string')
    && (value.dependencyType === null || typeof value.dependencyType === 'string')
    && typeof value.autoMergeEnabled === 'boolean';
}

function isAllowedPath(filePath: string, allowDevDependencyFiles: boolean): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  const lower = normalized.toLowerCase();

  if (normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..' || segment.toLowerCase() === '.github')) {
    return false;
  }

  const basename = lower.slice(lower.lastIndexOf('/') + 1);
  const dependencyManifest = lower === 'package.json' || lower === 'package-lock.json';
  const packageJsonOrLockfile = /^package.*\.json$/.test(basename)
    || basename.endsWith('.lock')
    || ['npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-lock.yml', 'bun.lock', 'bun.lockb']
      .includes(basename);
  if (packageJsonOrLockfile || lower === 'src/config.ts' || lower === 'src/github.ts') {
    if (!allowDevDependencyFiles || !dependencyManifest) {
      return false;
    }
  }

  return (allowDevDependencyFiles && dependencyManifest)
    || lower.endsWith('.md')
    || lower.startsWith('docs/')
    || /\.(?:test|spec)\.(?:ts|js|mts|cts)$/.test(lower);
}

export function evaluateAutoMergePolicy(
  input: unknown,
  options: AutoMergePolicyOptions = {},
): AutoMergePolicyEvaluation {
  const policyLabel = options.policyLabel ?? AUTO_MERGE_POLICY_LABEL;
  const requirePolicyLabel = options.requirePolicyLabel ?? true;
  const requireDependencyUpdateType = options.requireDependencyUpdateType ?? false;
  const blockers: string[] = [];
  const gates: AutoMergePolicyGate[] = [];

  const addGate = (name: string, allowed: boolean, detail: string): void => {
    gates.push({ name, allowed, detail });
    if (!allowed) {
      blockers.push(`${name}: ${detail}`);
    }
  };

  const valid = isPolicyInput(input);
  addGate('Context gate', valid, valid ? 'required PR metadata is well-formed.' : 'required PR metadata is missing or malformed.');
  if (!valid) {
    for (const name of [
      'Author gate', 'Branch gate', 'Repository scope gate', 'Draft gate', 'Changed-file gate',
      'Policy label gate', 'Policy deny-label gate', 'Review gate', 'Check gate', 'Merge-state gate',
      'Dependency update gate',
    ]) {
      addGate(name, false, 'PR context validation failed; evaluation is fail-closed.');
    }
    return { allowed: false, doArm: false, blockers, gates };
  }

  const authorLogin = input.author.login;
  const approvedAuthor = AUTO_MERGE_APPROVED_BOT_AUTHORS.includes(authorLogin as typeof AUTO_MERGE_APPROVED_BOT_AUTHORS[number]);
  const matchingCommitAuthor = input.headCommitAuthor.login === authorLogin;
  addGate(
    'Author gate',
    approvedAuthor && matchingCommitAuthor,
    approvedAuthor && matchingCommitAuthor
      ? 'PR creator and head commit author match an exact approved bot identity.'
      : 'PR creator and head commit author must match an exact approved bot identity.',
  );

  const allowedPrefix = (authorLogin === 'dependabot[bot]' && input.headRefName.startsWith('dependabot/'))
    || (authorLogin === 'renovate[bot]' && input.headRefName.startsWith('renovate/'));
  addGate(
    'Branch gate',
    allowedPrefix,
    allowedPrefix ? 'head branch matches the approved bot prefix.' : 'head branch is outside the approved bot prefix.',
  );

  addGate(
    'Repository scope gate',
    input.state === 'OPEN' && input.baseRefName === 'main',
    input.state === 'OPEN' && input.baseRefName === 'main'
      ? 'PR is open and targets main.'
      : 'PR must be open and target main.',
  );

  addGate('Draft gate', !input.isDraft, input.isDraft ? 'PR is still marked draft.' : 'PR is ready for review.');

  const patchOrMinor = input.dependencyUpdateType === 'version-update:semver-patch'
    || input.dependencyUpdateType === 'version-update:semver-minor';
  const developmentDependency = input.dependencyType === 'direct:development';
  const allowDevDependencyFiles = requireDependencyUpdateType && patchOrMinor && developmentDependency;
  const pathsAllowed = input.changedFileCount > 0
    && input.files.length === input.changedFileCount
    && input.files.every(filePath => isAllowedPath(filePath, allowDevDependencyFiles));
  addGate(
    'Changed-file gate',
    pathsAllowed,
    pathsAllowed ? 'all changed paths are in the documentation/test allowlist.' : 'changed paths are empty, malformed, denied, or outside the documentation/test allowlist.',
  );

  const labelNames = input.labels.map(label => label.name);
  addGate(
    'Policy label gate',
    !requirePolicyLabel || labelNames.includes(policyLabel),
    requirePolicyLabel && !labelNames.includes(policyLabel)
      ? `missing required ${policyLabel} policy label.`
      : requirePolicyLabel ? 'required policy label is present.' : 'policy label not required for this workflow.',
  );

  const denyLabelSet = new Set<string>(AUTO_MERGE_DENY_LABELS.map(label => label.toLowerCase()));
  const denyLabels = labelNames.filter(label => denyLabelSet.has(label.toLowerCase()));
  addGate(
    'Policy deny-label gate',
    denyLabels.length === 0,
    denyLabels.length === 0 ? 'no deny labels are present.' : 'one or more deny labels are present.',
  );

  const hasIndependentHumanApproval = input.reviews.some(review =>
    review.state === 'APPROVED'
      && review.login !== authorLogin
      && !review.login.endsWith('[bot]'));
  const reviewAllowed = input.reviewDecision === 'APPROVED' && hasIndependentHumanApproval;
  addGate(
    'Review gate',
    reviewAllowed,
    reviewAllowed ? 'an independent non-bot approval is present.' : 'an independent non-bot approval is required; missing or unknown fails closed.',
  );

  const checksAllowed = AUTO_MERGE_REQUIRED_CHECKS.every(requiredName => {
    const matching = input.checks.filter(check => check.name === requiredName);
    return matching.length > 0 && matching.every(check =>
      check.headSha === input.headSha && check.status === 'COMPLETED' && check.conclusion === 'SUCCESS');
  });
  addGate(
    'Check gate',
    checksAllowed,
    checksAllowed ? 'required checks succeeded for the exact head SHA.' : 'required checks must succeed for the exact head SHA.',
  );

  addGate(
    'Merge-state gate',
    input.mergeStateStatus === 'CLEAN',
    input.mergeStateStatus === 'CLEAN' ? 'GitHub reports a clean merge state.' : 'merge state is not CLEAN or is unknown.',
  );

  const dependencyTypeAllowed = !requireDependencyUpdateType
    || (patchOrMinor && developmentDependency);
  addGate(
    'Dependency update gate',
    dependencyTypeAllowed,
    dependencyTypeAllowed
      ? requireDependencyUpdateType ? 'Dependabot update is a direct development dependency patch or minor.' : 'dependency update type not required.'
      : 'only direct development dependency patch and minor updates are eligible.',
  );

  const allowed = blockers.length === 0;
  return { allowed, doArm: allowed && !input.autoMergeEnabled, blockers, gates };
}
