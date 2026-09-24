import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseGitHubRepositoryLocator,
  repositoryIdentitiesEqual,
  repositoryLocatorsEqual,
  type GitHubRepositoryIdentity,
  type GitHubRepositoryKey,
  withRepositoryId,
} from './repo-discovery.js';
import { createRepoSeed } from './repo-seed.js';

describe('RepoDiscovery identity helpers', () => {
  it('parses canonical HTTPS locators and strips one .git suffix', () => {
    assert.deepEqual(parseGitHubRepositoryLocator('https://github.com/owner/repo'), {
      host: 'github.com', owner: 'owner', repository: 'repo',
    });
    assert.deepEqual(parseGitHubRepositoryLocator('https://github.com/owner/repo.git'), {
      host: 'github.com', owner: 'owner', repository: 'repo',
    });
  });

  it('parses the strict scp-style SSH form', () => {
    assert.deepEqual(parseGitHubRepositoryLocator('git@github.com:owner/repo.git'), {
      host: 'github.com', owner: 'owner', repository: 'repo',
    });
  });

  it('compares GitHub owner and repository names case-insensitively', () => {
    const left = parseGitHubRepositoryLocator('https://github.com/Owner/Repo');
    const right = parseGitHubRepositoryLocator('https://github.com/owner/repo.git');
    assert.equal(repositoryLocatorsEqual(left, right), true);
    assert.equal(repositoryLocatorsEqual(left, { ...right, repository: 'other' }), false);
  });

  it('compares resolved identities only when both decimal IDs match', () => {
    const locator = parseGitHubRepositoryLocator('https://github.com/owner/repo');
    const left = withRepositoryId(locator, '111');
    const right = withRepositoryId({ ...locator, owner: 'Owner' }, '111');
    assert.equal(repositoryIdentitiesEqual(left, right), true);
    assert.equal(repositoryIdentitiesEqual(left, { ...right, repositoryId: '222' }), false);
    assert.equal(repositoryIdentitiesEqual(left, { ...right, repositoryId: undefined }), false);
    assert.throws(() => withRepositoryId(locator, '01'));
    assert.throws(() => withRepositoryId(locator, '0'));
    assert.throws(() => withRepositoryId(locator, '1 '));
  });

  it('keeps repository IDs as decimal strings for later resolution', () => {
    const identity: GitHubRepositoryIdentity = {
      ...parseGitHubRepositoryLocator('https://github.com/owner/repo'),
      repositoryId: '12345678901234567890',
    };
    assert.equal(identity.repositoryId, '12345678901234567890');
  });

  it('rejects non-canonical hosts, credentials, query, and fragment', () => {
    for (const value of [
      'http://github.com/owner/repo',
      'https://github.com./owner/repo',
      'https://api.github.com/owner/repo',
      'https://user:pass@github.com/owner/repo',
      'https://github.com/owner/repo?x=1',
      'https://github.com/owner/repo#part',
    ]) {
      assert.throws(() => parseGitHubRepositoryLocator(value));
    }
  });

  it('rejects empty, extra, traversal-like, and malformed path components', () => {
    for (const value of [
      'https://github.com//repo',
      'https://github.com/owner/',
      'https://github.com/owner/repo/extra',
      'https://github.com/./repo',
      'https://github.com/owner/..',
      'https://github.com/owner/repo.git.git',
      'https://github.com/owner/%72epo',
      'https://github.com/owner/repo/../other',
      'https://github.com/a/b/../c',
      'https://github.com/owner/./repo',
    ]) {
      assert.throws(() => parseGitHubRepositoryLocator(value));
    }
  });

  it('rejects URL parser normalization and control-character inputs', () => {
    for (const value of [
      'https://github.com/owner/\trepo',
      'https://github.com/owner/repo\n',
      'https://github.com/owner/re\rpo',
      '\u0000https://github.com/owner/repo',
      'https://github.com/owner/repo\u0000',
      'HTTPS://GITHUB.COM/owner/repo',
      'https://github.com:443/owner/repo',
      'https://github.com．/owner/repo',
      'https://github.com\u00ad/owner/repo',
    ]) {
      assert.throws(() => parseGitHubRepositoryLocator(value));
    }
  });

  it('rejects malformed or ambiguous SSH forms', () => {
    for (const value of [
      'ssh://git@github.com/owner/repo.git',
      'git@github.com:owner',
      'git@github.com:/repo',
      'git@github.com:owner/repo/extra',
      'git@github.com:owner/repo?x=1',
      'git@github.com:owner/repo#part',
      'git@github.com:owner/repo.git.git',
      'git@github.com.evil.example:owner/repo',
    ]) {
      assert.throws(() => parseGitHubRepositoryLocator(value));
    }
  });

  it('treats the numeric repositoryId as identity across rename and transfer', () => {
    const original = withRepositoryId(
      parseGitHubRepositoryLocator('https://github.com/old-owner/old-name'),
      '1236481916',
    );
    const renamed = withRepositoryId(
      parseGitHubRepositoryLocator('https://github.com/old-owner/new-name'),
      '1236481916',
    );
    const transferred = withRepositoryId(
      parseGitHubRepositoryLocator('git@github.com:new-owner/new-name.git'),
      '1236481916',
    );
    assert.equal(repositoryLocatorsEqual(original, transferred), false);
    assert.equal(repositoryIdentitiesEqual(original, renamed), true);
    assert.equal(repositoryIdentitiesEqual(original, transferred), true);
  });

  it('never equates a matching location without matching resolved IDs', () => {
    const locator = parseGitHubRepositoryLocator('https://github.com/owner/repo');
    assert.equal(
      repositoryIdentitiesEqual(withRepositoryId(locator, '111'), withRepositoryId(locator, '222')),
      false,
    );
    assert.equal(repositoryIdentitiesEqual(locator, locator), false);
    for (const repositoryId of ['01', ' 111', '111\n', '\u0661']) {
      assert.equal(
        repositoryIdentitiesEqual({ ...locator, repositoryId }, { ...locator, repositoryId }),
        false,
      );
    }
  });

  it('pins identity to github.com and compares a RepoSeed directly', () => {
    const seed = createRepoSeed({
      schemaVersion: '1',
      host: 'github.com',
      repositoryId: '123456789',
      objectFormat: 'sha1',
      commitSha: 'a961afb4f3ee11d1eadaf30eeb78d0db6cda58fb',
      treeSha: '20254353e29f00e0839b7c3f883e646bb435d4e5',
      seedSha256: '23b24facf3fc754a043902c717a28d9d7377b457dfd2448959df57b98a86bb92',
    });
    const target = withRepositoryId(
      parseGitHubRepositoryLocator('https://github.com/owner/repo'),
      '123456789',
    );
    assert.equal(repositoryIdentitiesEqual(seed, target), true);
    assert.equal(
      repositoryIdentitiesEqual(seed, { ...target, repositoryId: '123456780' }),
      false,
    );
    const foreign = {
      host: 'ghes.example',
      repositoryId: '123456789',
    } as unknown as GitHubRepositoryKey;
    assert.equal(repositoryIdentitiesEqual(foreign, foreign), false);
  });
});
