import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { snapshotRepo } from '../repo.js';
import { readBoundedRepositoryFile } from '../outbound-content.js';

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
    revparse: async () => 'abc1234567890123456789012345678901234567\n',
    raw: async () => 'abc1234567890123456789012345678901234567',
  } as any;

  it('excludes pem, key, and nested env files from text context', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      await fs.writeFile(path.join(root, 'private.pem'), '-----BEGIN PRIVATE KEY-----');
      await fs.writeFile(path.join(root, 'secret.key'), 'private-key-material');
      await fs.mkdir(path.join(root, 'nested'));
      await fs.writeFile(path.join(root, 'nested', '.env.local'), 'TOKEN=not-for-output');
      await fs.writeFile(path.join(root, 'credentials.json'), '{"token":"not-for-output"}');
      await fs.writeFile(path.join(root, '.npmrc'), '//registry.npmjs.org/:_authToken=not-for-output');
      await fs.mkdir(path.join(root, 'nested', '.git'));
      await fs.writeFile(path.join(root, 'nested', '.git', 'config'), '[remote]\nurl=private');

      const snapshot = await snapshotRepo(root, git);
      assert.equal(snapshot.files.some(file => /(?:\.pem|\.key|\.env|credentials\.json|\.npmrc|\.git)/i.test(file.path)), false);
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

  it('skips ordinary binary files without reading them', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      await fs.writeFile(path.join(root, 'unexpected.bin'), Buffer.from([0, 1, 2, 3]));
      const snapshot = await snapshotRepo(root, git);
      assert.equal(snapshot.files.some(file => file.path === 'unexpected.bin'), false);
    });

    it('fails closed when a recognized text file is not valid UTF-8', async () => {
      await withFixture(async root => {
        await fs.writeFile(path.join(root, 'README.md'), Buffer.from([0xff, 0xfe, 0xfd]));
        await assert.rejects(() => snapshotRepo(root, git), /unsupported repository text encoding/);
      });
    });
  });

  it('rejects oversized repository text before a provider call', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      await fs.writeFile(path.join(root, 'large.ts'), 'x'.repeat(80_001));
      await assert.rejects(
        () => snapshotRepo(root, git),
        /per-file byte limit/,
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

    it('does not let nested ignore negation re-include hard-excluded paths', async () => {
      await withFixture(async root => {
        await fs.mkdir(path.join(root, 'nested'));
        await fs.writeFile(path.join(root, 'nested', '.gitignore'), 'secrets.txt\n!secrets.txt\n');
        await fs.writeFile(path.join(root, 'nested', 'secrets.txt'), 'not-for-context');
        await fs.writeFile(path.join(root, 'nested', 'README.md'), '# Safe nested docs');
        const snapshot = await snapshotRepo(root, git);
        assert.equal(snapshot.files.some(file => file.path.endsWith('secrets.txt')), false);
      });

      it('derives byte-bounded package hints from the validated snapshot files', async () => {
        await withFixture(async root => {
          await fs.writeFile(path.join(root, 'README.md'), `# Safe project\n${'é'.repeat(7_000)}`);
          const snapshot = await snapshotRepo(root, git);
          assert.equal(snapshot.packageHints.length, 1);
          assert.ok(Buffer.byteLength(snapshot.packageHints[0], 'utf8') <= 8_000);
          assert.match(snapshot.packageHints[0], /^README\.md:\n/);
          assert.match(snapshot.packageHints[0], /\[truncated\]$/);
        });
      });
    });

    it('fails closed when a required ignore input is unreadable', async () => {
      await withFixture(async root => {
        await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
        await fs.mkdir(path.join(root, '.gitignore'));
        await assert.rejects(() => snapshotRepo(root, git));
      });
    });

    it('detects replacement between path validation and opening', async () => {
      await withFixture(async root => {
        const file = path.join(root, 'input.md');
        const replacement = path.join(root, 'replacement.md');
        await fs.writeFile(file, 'original');
        await fs.writeFile(replacement, 'replacement');
        await assert.rejects(
          () => readBoundedRepositoryFile(root, file, 100, async stage => {
            if (stage === 'after-path-check') {
              await fs.rm(file);
              await fs.rename(replacement, file);
            }
          }),
          /identity changed|symbolic link/i,
        );
      });
    });

    it('detects growth after the bounded read', async () => {
      await withFixture(async root => {
        const file = path.join(root, 'input.md');
        await fs.writeFile(file, 'small');
        await assert.rejects(
          () => readBoundedRepositoryFile(root, file, 100, async stage => {
            if (stage === 'after-read') await fs.appendFile(file, 'growth');
          }),
          /identity changed while reading/,
        );
      });
    });

    it('refuses Windows junctions when the platform permits creating one', async context => {
      if (process.platform !== 'win32') {
        context.skip('Windows-specific junction qualification');
        return;
      }
      await withFixture(async root => {
        const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'jackhammer-outside-'));
        try {
          await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
          await fs.writeFile(path.join(outside, 'README.md'), 'outside');
          try {
            await fs.symlink(outside, path.join(root, 'junction'), 'junction');
          } catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error
              && (error.code === 'EPERM' || error.code === 'EACCES')) {
              context.skip('Windows junction creation requires privileges unavailable to this process');
              return;
            }
            throw error;
          }
          await assert.rejects(
            () => snapshotRepo(root, git),
            /symbolic links and reparse points are not allowed/,
          );
        } finally {
          await fs.rm(outside, { recursive: true, force: true });
        }
      });
    });

    it('rejects missing bounded-read inputs', async () => {
      await withFixture(async root => {
        await assert.rejects(
          () => readBoundedRepositoryFile(root, path.join(root, 'missing.md'), 100),
          /ENOENT/,
        );
      });
    });
  });
});
