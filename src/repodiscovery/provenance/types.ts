import type { RepoSeedObjectFormat } from '../../reposeed/types.js';

declare const repositoryIdBrand: unique symbol;
declare const objectIdBrand: unique symbol;

/** Minted only by the verifier, from a validated RepoSeed. */
export type ProvenanceRepositoryId = string & { readonly [repositoryIdBrand]: true };
export type ProvenanceObjectId = string & { readonly [objectIdBrand]: true };

export type GitObjectType = 'commit' | 'tree' | 'blob' | 'tag';

/** Only `absent` is safe. `unknown` means the adapter could not establish the state. */
export type EnvironmentCheckState = 'absent' | 'present' | 'unknown';

/** GitHub evidence is queried by numeric repository ID only, never by owner/name. */
export interface GitHubRepositoryRequest {
  readonly repositoryId: string;
}

export interface GitHubRepositoryEvidence {
  /** Must echo the queried ID. */
  readonly repositoryId: string;
  /**
   * The adapter must establish this from an authoritative GitHub-side source and never infer
   * it from object ID length. An adapter that cannot establish it throws
   * `ProvenancePortError('ambiguous')`.
   */
  readonly objectFormat: RepoSeedObjectFormat;
}

export interface GitHubCommitRequest {
  readonly repositoryId: string;
  readonly commitOid: string;
}

export interface GitHubCommitEvidence {
  /** Must echo the queried ID; a fork parent's ID is a subject mismatch. */
  readonly repositoryId: string;
  /** Must echo the queried commit. */
  readonly commitOid: string;
  /** Root tree of the commit as recorded by GitHub. */
  readonly treeOid: string;
  /**
   * The adapter attests the commit is reachable from a ref of this repository, not merely
   * present in a fork network's shared object pool. The verifier cannot prove this itself.
   */
  readonly scope: 'repository-reachable';
}

export interface GitHubEvidencePort {
  getRepository(request: GitHubRepositoryRequest): Promise<GitHubRepositoryEvidence>;
  getCommit(request: GitHubCommitRequest): Promise<GitHubCommitEvidence>;
}

/** Local Git evidence uses full object IDs only; there is no ref or HEAD resolution. */
export interface GitEnvironmentEvidence {
  readonly objectFormat: RepoSeedObjectFormat;
  /** Whether object lookups may be redirected by refs/replace/. */
  readonly replaceRefs: EnvironmentCheckState;
  /** Whether objects may be borrowed from another object store. */
  readonly alternates: EnvironmentCheckState;
}

export interface GitObjectTypeEvidence {
  /** Must echo the queried object. */
  readonly oid: string;
  readonly type: GitObjectType;
}

export interface GitCommitTreeEvidence {
  /** Must echo the queried commit. */
  readonly commitOid: string;
  readonly treeOid: string;
}

export interface GitEvidencePort {
  getEnvironment(): Promise<GitEnvironmentEvidence>;
  getObjectType(oid: string): Promise<GitObjectTypeEvidence>;
  getCommitTree(commitOid: string): Promise<GitCommitTreeEvidence>;
}

export interface ProvenancePorts {
  readonly github: GitHubEvidencePort;
  readonly git: GitEvidencePort;
}

/** The seven validated RepoSeed fields, copied from the seed and never from evidence. */
export interface ProvenanceIdentity {
  readonly schemaVersion: '1';
  readonly host: 'github.com';
  readonly repositoryId: ProvenanceRepositoryId;
  readonly objectFormat: RepoSeedObjectFormat;
  readonly commitSha: ProvenanceObjectId;
  readonly treeSha: ProvenanceObjectId;
  /** RepoSeed identity-protocol digest. Not a content, tree or filesystem digest. */
  readonly seedSha256: string;
}

/**
 * A point-in-time verification result. It grants nothing: consumers must re-run verification
 * before acting, and freezing does not make it authentic, fresh or single-use.
 */
export interface ProvenanceCertificate {
  readonly kind: 'jackhammer.repodiscovery.provenance';
  readonly version: '1';
  readonly identity: ProvenanceIdentity;
  readonly githubCommitScope: 'repository-reachable';
  readonly authorizes: false;
  readonly requiresReverification: true;
}
