export interface GitHubRepositoryLocator {
  readonly host: 'github.com';
  readonly owner: string;
  readonly repository: string;
}

export interface GitHubRepositoryIdentity extends GitHubRepositoryLocator {
  /** Populated later by an authenticated GitHub repository lookup. */
  readonly repositoryId?: string;
}

const COMPONENT = /^[A-Za-z0-9_.-]+$/;

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

function parseHttpsLocator(raw: string): GitHubRepositoryLocator {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Repository locator must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com'
      || url.port !== '' || url.username !== '' || url.password !== ''
      || url.search !== '' || url.hash !== '' || raw.includes('%')) {
    throw new Error('Repository locator must be a canonical GitHub HTTPS URL');
  }
  const parts = url.pathname.split('/').slice(1);
  return buildLocator(parts);
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
