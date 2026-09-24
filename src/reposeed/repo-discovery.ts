export interface GitHubRepositoryLocator {
  readonly host: 'github.com';
  readonly owner: string;
  readonly repository: string;
}

export interface GitHubRepositoryIdentity extends GitHubRepositoryLocator {
  /** Populated later by an authenticated GitHub repository lookup. */
  readonly repositoryId?: string;
}

/** The authoritative part of an identity. Resolved identities and RepoSeeds both satisfy it. */
export type GitHubRepositoryKey = Pick<GitHubRepositoryIdentity, 'host' | 'repositoryId'>;

const COMPONENT = /^[A-Za-z0-9_.-]+$/;
const REPOSITORY_ID = /^[1-9][0-9]*$/;

export function parseGitHubRepositoryLocator(raw: string): GitHubRepositoryLocator {
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim() || raw.includes('\\')) {
    throw new Error('Repository locator must be a non-empty, untrimmed string');
  }

  if (raw.startsWith('git@')) {
    return parseScpLocator(raw);
  }
  return parseHttpsLocator(raw);
}

export function repositoryLocatorsEqual(
  left: GitHubRepositoryLocator,
  right: GitHubRepositoryLocator,
): boolean {
  return left.host === right.host
    && left.owner.toLowerCase() === right.owner.toLowerCase()
    && left.repository.toLowerCase() === right.repository.toLowerCase();
}

/**
 * Identity comparison: the GitHub numeric repositoryId is authoritative and owner/repository are
 * ignored, so a rename or transfer that keeps the ID is the same repository. false means "not
 * proven the same" (unresolved, malformed, non-github.com, or a different ID), not "proven
 * different". This module does not authenticate IDs: only compare IDs from an authenticated
 * GitHub lookup or a verified RepoSeed.
 */
export function repositoryIdentitiesEqual(
  left: GitHubRepositoryKey,
  right: GitHubRepositoryKey,
): boolean {
  const leftId = resolvedRepositoryId(left);
  return leftId !== undefined && leftId === resolvedRepositoryId(right);
}

export function withRepositoryId(
  locator: GitHubRepositoryLocator,
  repositoryId: string,
): GitHubRepositoryIdentity {
  if (!isRepositoryId(repositoryId)) {
    throw new Error('repositoryId must be a positive decimal string');
  }
  return Object.freeze({ ...locator, repositoryId });
}

function parseHttpsLocator(raw: string): GitHubRepositoryLocator {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(raw);
  if (!match) {
    throw new Error('Repository locator must be a canonical GitHub HTTPS URL');
  }
  return buildLocator([match[1], match[2]]);
}

function parseScpLocator(raw: string): GitHubRepositoryLocator {
  const match = /^git@github\.com:([^/:]+)\/([^/:]+)$/.exec(raw);
  if (!match || raw.includes('?') || raw.includes('#')) {
    throw new Error('Repository locator must be a canonical GitHub scp-style URL');
  }
  return buildLocator([match[1], match[2]]);
}

function buildLocator(parts: string[]): GitHubRepositoryLocator {
  if (parts.length !== 2) {
    throw new Error('Repository locator must contain exactly owner/repository');
  }
  const owner = parts[0];
  const repositoryWithSuffix = parts[1];
  if (!owner || !repositoryWithSuffix || !COMPONENT.test(owner) || !COMPONENT.test(repositoryWithSuffix)
      || owner === '.' || owner === '..' || repositoryWithSuffix === '.' || repositoryWithSuffix === '..') {
    throw new Error('Repository locator contains an invalid owner or repository');
  }
  const repository = repositoryWithSuffix.endsWith('.git')
    ? repositoryWithSuffix.slice(0, -4)
    : repositoryWithSuffix;
  if (!repository || repository.endsWith('.git') || repository === '.' || repository === '..') {
    throw new Error('Repository locator contains a malformed .git suffix');
  }
  return Object.freeze({ host: 'github.com', owner, repository });
}

/** Reads host and repositoryId once; undefined unless github.com with a canonical ID. */
function resolvedRepositoryId(key: GitHubRepositoryKey): string | undefined {
  const { host, repositoryId } = key;
  return host === 'github.com' && isRepositoryId(repositoryId) ? repositoryId : undefined;
}

function isRepositoryId(value: string | undefined): value is string {
  return typeof value === 'string' && REPOSITORY_ID.test(value);
}
