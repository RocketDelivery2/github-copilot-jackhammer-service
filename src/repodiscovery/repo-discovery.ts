export interface GitHubRepositoryLocator {
  readonly host: 'github.com';
  readonly owner: string;
  readonly repository: string;
}

export interface GitHubRepositoryIdentity {
  readonly host: 'github.com';
  readonly owner: string;
  readonly repository: string;
  readonly repositoryId: string;
}

/** The authoritative part of an identity. Resolved identities and RepoSeeds both satisfy it. */
export type GitHubRepositoryKey = Pick<GitHubRepositoryIdentity, 'host' | 'repositoryId'>;

const COMPONENT = /^[A-Za-z0-9_.-]+$/;
const DOT_ONLY = /^\.+$/;
const REPOSITORY_ID = /^[1-9][0-9]*$/;

function isCanonicalComponent(value: string): boolean {
  return COMPONENT.test(value) && !DOT_ONLY.test(value);
}

export function parseGitHubRepositoryLocator(raw: string): GitHubRepositoryLocator {
  if (typeof raw !== 'string' || raw.length === 0 || raw !== raw.trim() || raw.includes('\\')) {
    throw new Error('Repository locator must be a non-empty trimmed string without backslashes');
  }

  if (raw.startsWith('git@')) {
    return parseScpLocator(raw);
  }
  return parseHttpsLocator(raw);
}

/** Locator equality intentionally accepts only the three-key locator; identities use ID equality. */
export function repositoryLocatorsEqual(
  left: GitHubRepositoryLocator,
  right: GitHubRepositoryLocator,
): boolean {
  const leftLocator = readCanonicalLocator(left);
  const rightLocator = readCanonicalLocator(right);
  return leftLocator !== undefined
    && rightLocator !== undefined
    && leftLocator.owner.toLowerCase() === rightLocator.owner.toLowerCase()
    && leftLocator.repository.toLowerCase() === rightLocator.repository.toLowerCase();
}

/**
 * Identity comparison: the GitHub numeric repositoryId is authoritative and owner/repository are
 * ignored, so a rename or transfer that keeps the ID is the same repository. false means "not
 * proven the same" (unresolved, malformed, non-github.com, or a different ID), not "proven
 * different". This module does not authenticate IDs: only compare IDs from an authenticated
 * GitHub lookup or a verified RepoSeed.
 */
export function repositoryIdentitiesEqual(
  left: GitHubRepositoryKey | null | undefined,
  right: GitHubRepositoryKey | null | undefined,
): boolean {
  const leftId = resolvedRepositoryId(left);
  return leftId !== undefined && leftId === resolvedRepositoryId(right);
}

/** Attach an ID only to a locator; passing a four-key identity is intentionally rejected. */
export function withRepositoryId(
  locator: GitHubRepositoryLocator,
  repositoryId: string,
): GitHubRepositoryIdentity {
  if (!isRepositoryId(repositoryId)) {
    throw new Error('repositoryId must be a positive decimal string');
  }
  const canonical = readCanonicalLocator(locator);
  if (!canonical) {
    throw new Error('Repository locator must be canonical github.com owner/repository');
  }
  return Object.freeze({
    host: canonical.host,
    owner: canonical.owner,
    repository: canonical.repository,
    repositoryId,
  });
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

function readCanonicalLocator(input: unknown): GitHubRepositoryLocator | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return undefined;
  }

  const value = input as Record<PropertyKey, unknown>;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3
      || !Object.prototype.hasOwnProperty.call(value, 'host')
      || !Object.prototype.hasOwnProperty.call(value, 'owner')
      || !Object.prototype.hasOwnProperty.call(value, 'repository')) {
    return undefined;
  }

  let host: unknown;
  let owner: unknown;
  let repository: unknown;
  try {
    ({ host, owner, repository } = value);
  } catch {
    return undefined;
  }

  if (host !== 'github.com'
      || typeof owner !== 'string'
      || typeof repository !== 'string'
      || !isCanonicalComponent(owner)
      || !isCanonicalComponent(repository)
      || /\.git$/i.test(repository)) {
    return undefined;
  }

  return { host: 'github.com', owner, repository };
}

function buildLocator(parts: string[]): GitHubRepositoryLocator {
  if (parts.length !== 2) {
    throw new Error('Repository locator must contain exactly owner/repository');
  }
  const owner = parts[0];
  const repositoryWithSuffix = parts[1];
  if (!owner || !repositoryWithSuffix || !isCanonicalComponent(owner)
      || !isCanonicalComponent(repositoryWithSuffix)) {
    throw new Error('Repository locator contains an invalid owner or repository');
  }
  const repository = repositoryWithSuffix.endsWith('.git')
    ? repositoryWithSuffix.slice(0, -4)
    : repositoryWithSuffix;
  if (!repository || /\.git$/i.test(repository) || !isCanonicalComponent(repository)) {
    throw new Error('Repository locator contains a malformed .git suffix');
  }
  return Object.freeze({ host: 'github.com', owner, repository });
}

/** Reads host and repositoryId once; undefined unless github.com with a canonical ID. */
function resolvedRepositoryId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  try {
    const hostDescriptor = Object.getOwnPropertyDescriptor(value, 'host');
    const repositoryIdDescriptor = Object.getOwnPropertyDescriptor(value, 'repositoryId');
    if (!hostDescriptor || !('value' in hostDescriptor)
        || !repositoryIdDescriptor || !('value' in repositoryIdDescriptor)) {
      return undefined;
    }

    const host = hostDescriptor.value;
    const repositoryId = repositoryIdDescriptor.value;
    return host === 'github.com'
      && typeof repositoryId === 'string'
      && isRepositoryId(repositoryId)
      ? repositoryId
      : undefined;
  } catch {
    return undefined;
  }
}

function isRepositoryId(value: string | undefined): value is string {
  return typeof value === 'string' && REPOSITORY_ID.test(value);
}
