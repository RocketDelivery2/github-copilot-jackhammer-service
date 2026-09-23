export type RepoSeedObjectFormat = 'sha1' | 'sha256';

export interface RepoSeedFields {
  readonly schemaVersion: '1';
  readonly host: 'github.com';
  readonly repositoryId: string;
  readonly objectFormat: RepoSeedObjectFormat;
  readonly commitSha: string;
  readonly treeSha: string;
}

export interface RepoSeed extends RepoSeedFields {
  readonly seedSha256: string;
}
