// Deterministic in-memory evidence ports for tests. No network, process or filesystem access.
import { computeRepoSeedSha256 } from '../../reposeed/repo-seed.js';
import type { RepoSeed, RepoSeedFields } from '../../reposeed/types.js';
import { ProvenancePortError } from './errors.js';
import type {
  GitEvidencePort,
  GitHubCommitRequest,
  GitHubEvidencePort,
  GitHubRepositoryRequest,
  ProvenancePorts,
} from './types.js';

export const SHA1_FIELDS: RepoSeedFields = Object.freeze({
  schemaVersion: '1',
  host: 'github.com',
  repositoryId: '1048576001',
  objectFormat: 'sha1',
  commitSha: '1111111111111111111111111111111111111111',
  treeSha: '2222222222222222222222222222222222222222',
});

export const SHA256_FIELDS: RepoSeedFields = Object.freeze({
  schemaVersion: '1',
  host: 'github.com',
  repositoryId: '9007199254740993',
  objectFormat: 'sha256',
  commitSha: '3'.repeat(64),
  treeSha: '4'.repeat(64),
});

/** A plain, mutable seed object with a correct digest. */
export function makeSeed(overrides: Partial<RepoSeedFields> = {}): RepoSeed {
  const fields = { ...SHA1_FIELDS, ...overrides };
  return { ...fields, seedSha256: computeRepoSeedSha256(fields) };
}

export type Call = readonly string[];

export interface FakeHandlers {
  getRepository?: (repositoryId: string) => unknown;
  getCommit?: (repositoryId: string, commitOid: string) => unknown;
  /** sample is 0 for the first environment read and 1 for the re-check. */
  getEnvironment?: (sample: number) => unknown;
  getObjectType?: (oid: string) => unknown;
  getCommitTree?: (commitOid: string) => unknown;
}

/** Records each call, then answers from a handler. Methods live on the prototype. */
export class FakeGitHubEvidencePort {
  constructor(
    private readonly calls: Call[],
    private readonly handlers: Required<Pick<FakeHandlers, 'getRepository' | 'getCommit'>>,
  ) {}

  async getRepository(request: GitHubRepositoryRequest): Promise<never> {
    this.calls.push(['github.getRepository', request.repositoryId]);
    return this.handlers.getRepository(request.repositoryId) as never;
  }

  async getCommit(request: GitHubCommitRequest): Promise<never> {
    this.calls.push(['github.getCommit', request.repositoryId, request.commitOid]);
    return this.handlers.getCommit(request.repositoryId, request.commitOid) as never;
  }
}

export class FakeGitEvidencePort {
  private environmentSamples = 0;

  constructor(
    private readonly calls: Call[],
    private readonly handlers: Required<Pick<FakeHandlers, 'getEnvironment' | 'getObjectType' | 'getCommitTree'>>,
  ) {}

  async getEnvironment(): Promise<never> {
    this.calls.push(['git.getEnvironment']);
    return this.handlers.getEnvironment(this.environmentSamples++) as never;
  }

  async getObjectType(oid: string): Promise<never> {
    this.calls.push(['git.getObjectType', oid]);
    return this.handlers.getObjectType(oid) as never;
  }

  async getCommitTree(commitOid: string): Promise<never> {
    this.calls.push(['git.getCommitTree', commitOid]);
    return this.handlers.getCommitTree(commitOid) as never;
  }
}

/** Throws a branded port error, as a real adapter would for a missing object. */
export function notFound(): never {
  throw new ProvenancePortError('not-found', 'object not found');
}

/**
 * Ports that describe exactly one healthy repository revision: the given fields. Any handler
 * can be replaced to inject a failure or hostile evidence.
 */
export function createFakePorts(
  fields: RepoSeedFields,
  overrides: FakeHandlers = {},
): { ports: ProvenancePorts; calls: Call[] } {
  const calls: Call[] = [];
  const defaults: Required<FakeHandlers> = {
    getRepository: (repositoryId) => repositoryId === fields.repositoryId
      ? { repositoryId, objectFormat: fields.objectFormat }
      : notFound(),
    getCommit: (repositoryId, commitOid) => repositoryId === fields.repositoryId
      && commitOid === fields.commitSha
      ? { repositoryId, commitOid, treeOid: fields.treeSha, scope: 'repository-reachable' }
      : notFound(),
    getEnvironment: () => ({ objectFormat: fields.objectFormat, replaceRefs: 'absent', alternates: 'absent' }),
    getObjectType: (oid) => {
      if (oid === fields.commitSha) {
        return { oid, type: 'commit' };
      }
      return oid === fields.treeSha ? { oid, type: 'tree' } : notFound();
    },
    getCommitTree: (commitOid) => commitOid === fields.commitSha
      ? { commitOid, treeOid: fields.treeSha }
      : notFound(),
  };
  const handlers = { ...defaults, ...overrides } as Required<FakeHandlers>;
  const github: GitHubEvidencePort = new FakeGitHubEvidencePort(calls, handlers);
  const git: GitEvidencePort = new FakeGitEvidencePort(calls, handlers);
  return { ports: { github, git }, calls };
}

/** The exact call sequence of a successful verification: 2 GitHub, then 5 local. */
export function expectedCalls(fields: RepoSeedFields): Call[] {
  return [
    ['github.getRepository', fields.repositoryId],
    ['github.getCommit', fields.repositoryId, fields.commitSha],
    ['git.getEnvironment'],
    ['git.getObjectType', fields.commitSha],
    ['git.getCommitTree', fields.commitSha],
    ['git.getObjectType', fields.treeSha],
    ['git.getEnvironment'],
  ];
}
