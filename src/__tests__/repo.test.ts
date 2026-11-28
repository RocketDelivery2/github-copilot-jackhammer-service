import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { snapshotRepo } from '../repo.js';

describe('outbound repository safety', () => {
  async function withFixture<T>(run: (root: string) => Promise<T>): Promise<T> {
    const previousKey = process.env.OPENAI_API_KEY;
    const previousGithub = process.env.GITHUB_TOKEN;
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.GITHUB_TOKEN = 'test-token';
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jackhammer-repo-'));
    try {
      await fs.mkdir(path.join(root, '.git'));
      return await run(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousGithub === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previousGithub;
    }
  }

  const git = {
    revparse: async () => 'abc1234\n',
    raw: async () => 'abc1234 baseline',
  } as any;

  it('excludes pem, key, and nested env files from text context', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      await fs.writeFile(path.join(root, 'private.pem'), '-----BEGIN PRIVATE KEY-----');
      await fs.writeFile(path.join(root, 'secret.key'), 'private-key-material');
      await fs.mkdir(path.join(root, 'nested'));
      await fs.writeFile(path.join(root, 'nested', '.env.local'), 'TOKEN=not-for-output');

      const snapshot = await snapshotRepo(root, git);
      assert.equal(snapshot.files.some(file => /(?:\.pem|\.key|\.env)/i.test(file.path)), false);
    });
  });

  it('refuses symlinks escaping the repository root', async () => {
    if (process.platform === 'win32') {
      return;
    }
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      const outside = path.join(root, '..', 'jackhammer-outside.txt');
      await fs.writeFile(outside, 'outside');
      try {
        await fs.symlink(outside, path.join(root, 'escape.md'));
        await assert.rejects(
          () => snapshotRepo(root, git),
          /symbolic links and reparse points are not allowed/,
        );
      } finally {
        await fs.rm(outside, { force: true });
      }
    });
  });

  it('rejects unexpected binary files', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      await fs.writeFile(path.join(root, 'unexpected.bin'), Buffer.from([0, 1, 2, 3]));
      await assert.rejects(
        () => snapshotRepo(root, git),
        /unsupported binary file type/,
      );
    });
  });

  it('rejects oversized repository text before a provider call', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      await fs.writeFile(path.join(root, 'large.ts'), 'x'.repeat(80_001));
      await assert.rejects(
        () => snapshotRepo(root, git),
        /per-file size limit/,
      );
    });
  });

  it('stops when the repository source identity input is missing', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      const missingGit = {
        revparse: async () => '',
        raw: async () => 'baseline',
      } as any;
      await assert.rejects(
        () => snapshotRepo(root, missingGit),
        /source identity is missing or unreadable/,
      );
    });
  });

  it('does not classify nested excluded files as repository context', async () => {
    await withFixture(async root => {
      await fs.mkdir(path.join(root, 'nested'));
      await fs.writeFile(path.join(root, 'nested', 'README.md'), '# Nested');
      await fs.writeFile(path.join(root, 'nested', '.env'), 'API_KEY=secret');
      const snapshot = await snapshotRepo(root, git);
      assert.equal(snapshot.files.some(file => file.path.includes('.env')), false);
    });
  });
});
