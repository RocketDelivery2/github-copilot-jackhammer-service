import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseGitHubRepositoryLocator,
  repositoryLocatorsEqual,
  type GitHubRepositoryIdentity,
} from './repo-discovery.js';

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
});
