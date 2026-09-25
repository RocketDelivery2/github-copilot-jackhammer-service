import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseGitHubRepositoryLocator,
  repositoryIdentitiesEqual,
  repositoryLocatorsEqual,
  type GitHubRepositoryIdentity,
  type GitHubRepositoryKey,
  type GitHubRepositoryLocator,
  withRepositoryId,
} from './repo-discovery.js';
import { createRepoSeed } from './repo-seed.js';

function assertLocatorRejected(value: string, message: RegExp = /^Repository locator /): void {
  assert.throws(
    () => parseGitHubRepositoryLocator(value),
    { name: 'Error', message },
  );
}

function assertRepositoryIdRejected(locator: GitHubRepositoryLocator, repositoryId: string): void {
  assert.throws(
    () => withRepositoryId(locator, repositoryId),
    { name: 'Error', message: /^repositoryId must be a positive decimal string$/ },
  );
}

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
    assertRepositoryIdRejected(locator, '01');
    assertRepositoryIdRejected(locator, '0');
    assertRepositoryIdRejected(locator, '1 ');
  });

  it('preserves exact repository IDs through the module and freezes outputs', () => {
    const locator = parseGitHubRepositoryLocator('https://github.com/owner/repo');
    const identity: GitHubRepositoryIdentity = withRepositoryId(
      locator,
      '12345678901234567890',
    );
    assert.equal(identity.repositoryId, '12345678901234567890');
    assert.equal(Object.isFrozen(locator), true);
    assert.equal(Object.isFrozen(identity), true);
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
      assertLocatorRejected(value);
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
      assertLocatorRejected(value);
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
      assertLocatorRejected(value);
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
      assertLocatorRejected(value);
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

  it('rejects scp lookalikes, anchor bypasses, and non-canonical components', () => {
    for (const value of [
      'git@evil.example:x/git@github.com:owner/repo',
      'git@GITHUB.COM:owner/repo',
      'git@github.com:owner/re po',
      'git@github.com:owner/%repo',
      'git@github.com:ownеr/repo',
    ]) {
      assertLocatorRejected(value);
    }
    assertLocatorRejected(
      'https://github.com/../repo',
      /^Repository locator contains an invalid owner or repository$/,
    );
    assertLocatorRejected(
      'https://github.com/owner/...git',
      /^Repository locator contains a malformed \.git suffix$/,
    );
  });

  it('fails closed when locator comparison receives non-canonical runtime objects', () => {
    const canonical = parseGitHubRepositoryLocator('https://github.com/kevin/repo');
    const kelvin = {
      host: 'github.com',
      owner: '\u212Aevin',
      repository: 'repo',
    } as unknown as GitHubRepositoryLocator;
    const foreign = {
      host: 'evil.example',
      owner: 'kevin',
      repository: 'repo',
    } as unknown as GitHubRepositoryLocator;
    const missingOwner = {
      host: 'github.com',
      repository: 'repo',
    } as unknown as GitHubRepositoryLocator;

    assert.equal(repositoryLocatorsEqual(kelvin, canonical), false);
    assert.equal(repositoryLocatorsEqual(foreign, canonical), false);
    assert.equal(repositoryLocatorsEqual(missingOwner, canonical), false);
  });

  it('binds repository IDs only to canonical runtime locators', () => {
    const canonical = parseGitHubRepositoryLocator('https://github.com/owner/repo');
    const rebound = withRepositoryId({ ...canonical }, '111');
    assert.deepEqual(rebound, {
      host: 'github.com',
      owner: 'owner',
      repository: 'repo',
      repositoryId: '111',
    });

    for (const locator of [
      { host: 'evil.example', owner: 'owner', repository: 'repo' },
      { host: 'github.com', owner: 'not/valid', repository: 'repo' },
      { host: 'github.com', owner: 'owner', repository: '..' },
      { host: 'github.com', owner: 'owner', repository: 'repo', evil: 'x' },
    ]) {
      assert.throws(
        () => withRepositoryId(locator as unknown as GitHubRepositoryLocator, '111'),
        {
          name: 'Error',
          message: /^Repository locator must be canonical github\.com owner\/repository$/,
        },
      );
    }
  });

});
