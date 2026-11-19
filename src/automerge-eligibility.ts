/**
 * Deterministic, fail-closed eligibility policy for unattended auto-merge.
 *
 * This module is pure: it performs no I/O and never calls Git or GitHub.
 * The safe-automerge workflow gathers PR evidence, passes it in, and only
 * merges when `eligible && enabled` is true for the exact head SHA.
 *
 * Labels, titles, bodies, and comments can only ever block a merge; they never
 * authorize one. Authorization comes from an explicit task-type allowlist that
 * is keyed on PR author, head-branch prefix, changed paths, required checks,
 * and (for docs) a human approval on the exact head commit.
 */

export const UNATTENDED_TASK_TYPES = ['dependabot-patch', 'docs-only'] as const;
export type UnattendedTaskType = typeof UNATTENDED_TASK_TYPES[number];

export const REQUIRED_CHECK_NAMES = ['test-and-build', 'CodeQL'] as const;

export const UNATTENDED_DENY_LABELS = [
  'security',
  'breaking-change',
  'do-not-merge',
  'no-auto-merge',
  'needs-review',
] as const;

export const DEPENDABOT_LOGIN = 'dependabot[bot]';
export const DEPENDABOT_BRANCH_PREFIX = 'dependabot/npm_and_yarn/';
export const DOCS_BRANCH_PREFIX = 'docs/';
export const DEPENDABOT_ALLOWED_PATHS = ['package.json', 'package-lock.json'] as const;
export const MAX_REPORTED_FILES = 100;

const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'STALE',
  'ERROR',
]);
const FAILING_STATUS_STATES = new Set(['FAILURE', 'ERROR']);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RANGE_PATTERN = /^([~^]?)((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const NPM_REGISTRY_PREFIX = 'https://registry.npmjs.org/';
const LOCK_ENTRY_BUMP_FIELDS = new Set([
  'version', 'resolved', 'integrity', 'dependencies', 'optionalDependencies', 'peerDependencies',
  'peerDependenciesMeta', 'engines', 'funding', 'bin', 'license',
]);
const DEPENDENCY_MAP_KEYS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

export type UnattendedPrEvidence = {
  number: number;
  state: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  authorLogin: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  labels: readonly string[];
  changedFiles: number;
  files: readonly string[];
  checks: readonly CheckEvidence[];
  reviews: readonly ReviewEvidence[];
};

export type CheckEvidence =
  | { kind: 'check-run'; name: string; status: string; conclusion: string | null }
  | { kind: 'status-context'; name: string; state: string };

export type ReviewEvidence = {
  authorLogin: string;
  state: string;
  commitOid: string | null;
};

/** Raw JSON text of package manifests at the PR base and head SHAs (dependabot only). */
export type ManifestEvidence = {
  basePackageJson: string;
  headPackageJson: string;
  baseLockfile: string;
  headLockfile: string;
};

/** One entry per PR commit, from the REST pulls/{n}/commits endpoint. */
export type CommitEvidence = {
  authorLogin: string;
  verified: boolean;
};

export type UnattendedPolicyContext = {
  expectedRepository: string;
  eventRepository: string;
  expectedHeadSha: string;
  enabledTaskTypes: readonly string[];
  manifests?: ManifestEvidence;
  commits?: readonly CommitEvidence[];
};

export type UnattendedGate = {
  name: string;
  allowed: boolean;
  detail: string;
};

export type UnattendedEvaluation = {
  /** True only when every policy gate passed for the exact head SHA. */
  eligible: boolean;
  /** True only when the matched task type is enabled by the repository owner. */
  enabled: boolean;
  taskType: UnattendedTaskType | null;
  headSha: string | null;
  blockers: string[];
  gates: UnattendedGate[];
};

function isBotLogin(login: string): boolean {
  return login.endsWith('[bot]');
}

/** Returns true when a path is a plain, repository-relative POSIX path. */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** Docs-only scope: Markdown under docs/ or the root README.md. */
export function isDocsPath(path: string): boolean {
  if (!isSafeRelativePath(path)) return false;
  if (path === 'README.md') return true;
  return path.startsWith('docs/') && path.endsWith('.md');
}

/**
 * Classifies a PR into exactly one allowlisted task type, or null.
 * Classification depends only on author and head-branch prefix.
 */
export function classifyTaskType(authorLogin: string, headRefName: string): UnattendedTaskType | null {
  const matches: UnattendedTaskType[] = [];
  if (authorLogin === DEPENDABOT_LOGIN && headRefName.startsWith(DEPENDABOT_BRANCH_PREFIX)) {
    matches.push('dependabot-patch');
  }
  if (headRefName.startsWith(DOCS_BRANCH_PREFIX) && !headRefName.startsWith(DEPENDABOT_BRANCH_PREFIX)) {
    matches.push('docs-only');
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Parses an enabled task-type list (comma separated). Unknown names make the
 * whole list invalid so a typo can never widen or silently narrow the scope.
 */
export function parseEnabledTaskTypes(raw: string | undefined): { valid: boolean; taskTypes: UnattendedTaskType[] } {
  const entries = (raw ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
  const known = new Set<string>(UNATTENDED_TASK_TYPES);
  if (entries.some(entry => !known.has(entry))) {
    return { valid: false, taskTypes: [] };
  }
  return { valid: true, taskTypes: [...new Set(entries)].sort() as UnattendedTaskType[] };
}

function parseSemver(version: string): [number, number, number] | null {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `next` is a strictly higher patch of `previous` (same major.minor). */
export function isPatchBump(previous: string, next: string): boolean {
  const a = parseSemver(previous);
  const b = parseSemver(next);
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && b[2] > a[2];
}

/** True when a range spec keeps its operator and only bumps the patch version. */
export function isPatchRangeBump(previous: string, next: string): boolean {
  const a = RANGE_PATTERN.exec(previous);
  const b = RANGE_PATTERN.exec(next);
  if (!a || !b) return false;
  return a[1] === b[1] && isPatchBump(a[2], b[2]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isPlainObject(parsed)) throw new Error(`${label} is not a JSON object`);
  return parsed;
}

/**
 * Compares dependency maps. Returns the number of patch-bumped entries, or an
 * error string when anything other than a patch range bump changed.
 */
function compareDependencyMaps(base: Record<string, unknown>, head: Record<string, unknown>, label: string): number | string {
  let bumps = 0;
  for (const key of DEPENDENCY_MAP_KEYS) {
    const baseMap = base[key] ?? {};
    const headMap = head[key] ?? {};
    if (!isPlainObject(baseMap) || !isPlainObject(headMap)) return `${label}.${key} is malformed`;
    const names = new Set([...Object.keys(baseMap), ...Object.keys(headMap)]);
    for (const name of [...names].sort()) {
      const before = baseMap[name];
      const after = headMap[name];
      if (before === after) continue;
      if (typeof before !== 'string' || typeof after !== 'string') {
        return `${label}.${key}.${name} was added, removed, or is not a string`;
      }
      if (!isPatchRangeBump(before, after)) {
        return `${label}.${key}.${name} changed ${before} -> ${after}, which is not a patch bump`;
      }
      bumps += 1;
    }
  }
  return bumps;
}

function withoutDependencyMaps(value: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  for (const key of DEPENDENCY_MAP_KEYS) delete copy[key];
  return copy;
}

/**
 * Verifies that a Dependabot change is patch-only by comparing the manifests
 * themselves, never PR titles or commit messages.
 */
export function verifyPatchOnlyManifests(manifests: ManifestEvidence): { ok: boolean; detail: string } {
  try {
    const basePkg = parseJsonObject(manifests.basePackageJson, 'base package.json');
    const headPkg = parseJsonObject(manifests.headPackageJson, 'head package.json');
    const baseLock = parseJsonObject(manifests.baseLockfile, 'base package-lock.json');
    const headLock = parseJsonObject(manifests.headLockfile, 'head package-lock.json');

    if (canonicalJson(withoutDependencyMaps(basePkg)) !== canonicalJson(withoutDependencyMaps(headPkg))) {
      return { ok: false, detail: 'package.json changed outside dependency maps (scripts, metadata, or config).' };
    }
    const pkgResult = compareDependencyMaps(basePkg, headPkg, 'package.json');
    if (typeof pkgResult === 'string') return { ok: false, detail: pkgResult };

    if (baseLock.lockfileVersion !== headLock.lockfileVersion) {
      return { ok: false, detail: 'package-lock.json lockfileVersion changed.' };
    }
    const basePackages = baseLock.packages;
    const headPackages = headLock.packages;
    if (!isPlainObject(basePackages) || !isPlainObject(headPackages)) {
      return { ok: false, detail: 'package-lock.json has no packages map.' };
    }
    const baseKeys = Object.keys(basePackages).sort();
    const headKeys = Object.keys(headPackages).sort();
    if (canonicalJson(baseKeys) !== canonicalJson(headKeys)) {
      return { ok: false, detail: 'package-lock.json added or removed packages.' };
    }

    let lockBumps = 0;
    for (const key of baseKeys) {
      const before = basePackages[key];
      const after = headPackages[key];
      if (!isPlainObject(before) || !isPlainObject(after)) {
        return { ok: false, detail: `package-lock.json entry "${key}" is malformed.` };
      }
      if (key === '') {
        if (canonicalJson(withoutDependencyMaps(before)) !== canonicalJson(withoutDependencyMaps(after))) {
          return { ok: false, detail: 'package-lock.json root entry changed outside dependency maps.' };
        }
        const rootResult = compareDependencyMaps(before, after, 'package-lock.json root');
        if (typeof rootResult === 'string') return { ok: false, detail: rootResult };
        continue;
      }
      if (before.version === after.version) {
        if (canonicalJson(before) !== canonicalJson(after)) {
          return { ok: false, detail: `package-lock.json "${key}" changed without a version bump.` };
        }
        continue;
      }
      if (typeof before.version !== 'string' || typeof after.version !== 'string') {
        return { ok: false, detail: `package-lock.json entry "${key}" has a missing version.` };
      }
      if (!isPatchBump(before.version, after.version)) {
        return { ok: false, detail: `package-lock.json "${key}" changed ${before.version} -> ${after.version}, which is not a patch bump.` };
      }
      const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(field => canonicalJson(before[field]) !== canonicalJson(after[field]));
      const unexpectedKeys = changedKeys.filter(field => !LOCK_ENTRY_BUMP_FIELDS.has(field));
      if (unexpectedKeys.length > 0) {
        return { ok: false, detail: `package-lock.json "${key}" changed unexpected fields: ${unexpectedKeys.sort().join(', ')}.` };
      }
      if (typeof after.resolved !== 'string' || !after.resolved.startsWith(NPM_REGISTRY_PREFIX)) {
        return { ok: false, detail: `package-lock.json "${key}" does not resolve to the npm registry.` };
      }
      lockBumps += 1;
    }

    if (pkgResult + lockBumps === 0) {
      return { ok: false, detail: 'no dependency version change detected.' };
    }
    return { ok: true, detail: `patch-only: ${pkgResult} manifest and ${lockBumps} lockfile version bumps.` };
  } catch (error) {
    return { ok: false, detail: `manifest evidence is malformed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Evaluates required checks for the exact head. Any ambiguity blocks. */
export function evaluateChecks(checks: readonly CheckEvidence[]): { ok: boolean; detail: string } {
  const failing = checks.filter(check => check.kind === 'check-run'
    ? check.status === 'COMPLETED' && FAILING_CONCLUSIONS.has(check.conclusion ?? '')
    : FAILING_STATUS_STATES.has(check.state));
  if (failing.length > 0) {
    return { ok: false, detail: `failing checks: ${[...new Set(failing.map(check => check.name))].sort().join(', ')}.` };
  }

  for (const name of REQUIRED_CHECK_NAMES) {
    const matching = checks.filter(check => check.name === name);
    if (matching.length === 0) {
      return { ok: false, detail: `required check ${name} is missing on the head commit.` };
    }
    const allSuccess = matching.every(check => check.kind === 'check-run'
      ? check.status === 'COMPLETED' && check.conclusion === 'SUCCESS'
      : check.state === 'SUCCESS');
    if (!allSuccess) {
      return { ok: false, detail: `required check ${name} is pending or not successful.` };
    }
  }
  return { ok: true, detail: `required checks succeeded: ${REQUIRED_CHECK_NAMES.join(', ')}.` };
}

/**
 * Docs-only PRs need a human approval on the exact head commit from someone
 * other than the PR author, and no reviewer's latest review requesting changes.
 */
export function evaluateHumanApproval(
  reviews: readonly ReviewEvidence[],
  authorLogin: string,
  headSha: string,
): { ok: boolean; detail: string } {
  const latestByReviewer = new Map<string, ReviewEvidence>();
  for (const review of reviews) {
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    latestByReviewer.set(review.authorLogin, review);
  }
  const changesRequested = [...latestByReviewer.values()].filter(review => review.state === 'CHANGES_REQUESTED');
  if (changesRequested.length > 0) {
    return { ok: false, detail: `changes requested by ${changesRequested.map(review => review.authorLogin).sort().join(', ')}.` };
  }
  const approvers = [...latestByReviewer.values()].filter(review =>
    review.state === 'APPROVED'
    && review.commitOid === headSha
    && review.authorLogin !== authorLogin
    && review.authorLogin.length > 0
    && !isBotLogin(review.authorLogin));
  if (approvers.length === 0) {
    return { ok: false, detail: 'no human, non-author approval on the exact head commit.' };
  }
  return { ok: true, detail: `approved at exact head by ${approvers.map(review => review.authorLogin).sort().join(', ')}.` };
}

export function evaluateUnattendedMerge(
  pr: UnattendedPrEvidence,
  context: UnattendedPolicyContext,
): UnattendedEvaluation {
  const gates: UnattendedGate[] = [];
  const blockers: string[] = [];
  const addGate = (name: string, allowed: boolean, detail: string): void => {
    gates.push({ name, allowed, detail });
    if (!allowed) blockers.push(`${name}: ${detail}`);
  };

  addGate(
    'Repository',
    context.eventRepository === context.expectedRepository,
    `event repository ${context.eventRepository}, expected ${context.expectedRepository}.`,
  );

  const headValid = SHA_PATTERN.test(pr.headRefOid) && SHA_PATTERN.test(context.expectedHeadSha);
  addGate(
    'Exact head',
    headValid && pr.headRefOid === context.expectedHeadSha,
    headValid
      ? `observed ${pr.headRefOid}, expected ${context.expectedHeadSha}.`
      : 'head SHA evidence is missing or malformed.',
  );

  addGate('Open and ready', pr.state === 'OPEN' && !pr.isDraft, `state=${pr.state}, draft=${pr.isDraft}.`);
  addGate('Base branch', pr.baseRefName === 'main', `base is ${pr.baseRefName}.`);
  addGate('Same repository', !pr.isCrossRepository, pr.isCrossRepository ? 'PR comes from a fork.' : 'PR head is in this repository.');

  const denyLabels = pr.labels.filter(label => (UNATTENDED_DENY_LABELS as readonly string[]).includes(label));
  addGate('Deny labels', denyLabels.length === 0, denyLabels.length > 0 ? `present: ${denyLabels.sort().join(', ')}.` : 'none present.');

  addGate(
    'Merge state',
    pr.mergeStateStatus === 'CLEAN',
    `mergeStateStatus=${pr.mergeStateStatus}; only CLEAN is accepted.`,
  );
  addGate(
    'Review decision',
    pr.reviewDecision !== 'CHANGES_REQUESTED' && pr.reviewDecision !== 'REVIEW_REQUIRED',
    `reviewDecision=${pr.reviewDecision ?? 'none'}.`,
  );

  const checkResult = evaluateChecks(pr.checks);
  addGate('Required checks', checkResult.ok, checkResult.detail);

  const fileListComplete = pr.files.length > 0
    && pr.files.length === pr.changedFiles
    && pr.files.length < MAX_REPORTED_FILES
    && new Set(pr.files).size === pr.files.length;
  addGate(
    'Changed-file evidence',
    fileListComplete,
    `listed ${pr.files.length} files, PR reports ${pr.changedFiles}.`,
  );

  const taskType = classifyTaskType(pr.authorLogin, pr.headRefName);
  addGate(
    'Task type',
    taskType !== null,
    taskType ? `classified as ${taskType}.` : `no allowlisted task type for author ${pr.authorLogin} on ${pr.headRefName}.`,
  );

  if (taskType === 'dependabot-patch') {
    const unexpected = pr.files.filter(file => !(DEPENDABOT_ALLOWED_PATHS as readonly string[]).includes(file));
    addGate(
      'Changed-file scope',
      fileListComplete && unexpected.length === 0,
      unexpected.length > 0 ? `files outside package.json/package-lock.json: ${unexpected.sort().join(', ')}.` : 'package manifests only.',
    );
    const commits = context.commits ?? [];
    const foreignCommits = commits.filter(commit => commit.authorLogin !== DEPENDABOT_LOGIN || !commit.verified);
    addGate(
      'Commit provenance',
      commits.length > 0 && foreignCommits.length === 0,
      commits.length === 0
        ? 'commit evidence was not provided.'
        : foreignCommits.length > 0
          ? `${foreignCommits.length} commit(s) not authored by ${DEPENDABOT_LOGIN} with a verified signature.`
          : `${commits.length} verified ${DEPENDABOT_LOGIN} commit(s).`,
    );
    const manifestResult = context.manifests
      ? verifyPatchOnlyManifests(context.manifests)
      : { ok: false, detail: 'manifest evidence was not provided.' };
    addGate('Patch-only update', manifestResult.ok, manifestResult.detail);
  } else if (taskType === 'docs-only') {
    const unexpected = pr.files.filter(file => !isDocsPath(file));
    addGate(
      'Changed-file scope',
      fileListComplete && unexpected.length === 0,
      unexpected.length > 0 ? `files outside docs scope: ${unexpected.sort().join(', ')}.` : 'docs Markdown only.',
    );
    const approval = evaluateHumanApproval(pr.reviews, pr.authorLogin, pr.headRefOid);
    addGate('Human approval', approval.ok, approval.detail);
  }

  const eligible = blockers.length === 0;
  const enabled = taskType !== null && context.enabledTaskTypes.includes(taskType);
  return {
    eligible,
    enabled,
    taskType,
    headSha: headValid ? pr.headRefOid : null,
    blockers,
    gates,
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Normalizes `gh pr view --json` output into policy evidence. Throws on any
 * structurally missing field so callers can fail closed.
 */
export function parsePrEvidence(raw: unknown): UnattendedPrEvidence {
  if (!isPlainObject(raw)) throw new Error('PR evidence is not an object');
  const required = ['number', 'state', 'isDraft', 'isCrossRepository', 'author', 'baseRefName', 'headRefName',
    'headRefOid', 'mergeStateStatus', 'labels', 'changedFiles', 'files', 'statusCheckRollup', 'reviews'];
  for (const key of required) {
    if (!(key in raw)) throw new Error(`PR evidence is missing ${key}`);
  }
  const author = raw.author;
  if (!isPlainObject(author) || typeof author.login !== 'string' || author.login.length === 0) {
    throw new Error('PR evidence has no author login');
  }
  if (typeof raw.number !== 'number' || typeof raw.changedFiles !== 'number'
    || typeof raw.isDraft !== 'boolean' || typeof raw.isCrossRepository !== 'boolean') {
    throw new Error('PR evidence has malformed scalar fields');
  }
  if (!Array.isArray(raw.labels) || !Array.isArray(raw.files) || !Array.isArray(raw.statusCheckRollup) || !Array.isArray(raw.reviews)) {
    throw new Error('PR evidence has malformed list fields');
  }

  const checks: CheckEvidence[] = raw.statusCheckRollup.map((entry: unknown) => {
    if (!isPlainObject(entry)) throw new Error('malformed check entry');
    if (entry.__typename === 'CheckRun') {
      return { kind: 'check-run', name: asString(entry.name), status: asString(entry.status), conclusion: typeof entry.conclusion === 'string' ? entry.conclusion : null };
    }
    if (entry.__typename === 'StatusContext') {
      return { kind: 'status-context', name: asString(entry.context), state: asString(entry.state) };
    }
    throw new Error('unknown check entry type');
  });

  const reviews: ReviewEvidence[] = raw.reviews.map((entry: unknown) => {
    if (!isPlainObject(entry)) throw new Error('malformed review entry');
    const reviewAuthor = isPlainObject(entry.author) ? asString(entry.author.login) : '';
    const commit = isPlainObject(entry.commit) ? asString(entry.commit.oid) : '';
    return { authorLogin: reviewAuthor, state: asString(entry.state), commitOid: commit.length > 0 ? commit : null };
  });

  return {
    number: raw.number,
    state: asString(raw.state),
    isDraft: raw.isDraft,
    isCrossRepository: raw.isCrossRepository,
    authorLogin: author.login,
    baseRefName: asString(raw.baseRefName),
    headRefName: asString(raw.headRefName),
    headRefOid: asString(raw.headRefOid),
    mergeStateStatus: asString(raw.mergeStateStatus),
    reviewDecision: typeof raw.reviewDecision === 'string' && raw.reviewDecision.length > 0 ? raw.reviewDecision : null,
    labels: raw.labels.map((label: unknown) => (isPlainObject(label) ? asString(label.name) : '')).filter(Boolean),
    changedFiles: raw.changedFiles,
    files: raw.files.map((file: unknown) => {
      if (!isPlainObject(file) || typeof file.path !== 'string') throw new Error('malformed file entry');
      return file.path;
    }),
    checks,
    reviews,
  };
}

/** Normalizes REST `pulls/{n}/commits` output (optionally `--paginate --slurp`). Throws on malformed input. */
export function parseCommitEvidence(raw: unknown): CommitEvidence[] {
  const pages = Array.isArray(raw) && raw.every(Array.isArray) ? (raw as unknown[][]).flat() : raw;
  if (!Array.isArray(pages)) throw new Error('commit evidence is not a list');
  return pages.map((entry: unknown) => {
    if (!isPlainObject(entry)) throw new Error('malformed commit entry');
    const author = isPlainObject(entry.author) ? asString(entry.author.login) : '';
    const commit = isPlainObject(entry.commit) ? entry.commit : {};
    const verification = isPlainObject(commit.verification) ? commit.verification : {};
    return { authorLogin: author, verified: verification.verified === true };
  });
}
