import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { snapshotRepo } from '../repo.js';
import type { RepoSnapshot } from '../types.js';
import {
  MAX_GITIGNORE_BYTES,
  MAX_GITIGNORE_TOTAL_BYTES,
  derivePackageHints,
  readBoundedRepositoryFile,
} from '../outbound-content.js';

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

  const unsupportedHandleContainmentReason =
    `opened-handle containment verification is unsupported on ${process.platform}`;

  function itWithHandleVerifiedReads(name: string, run: () => Promise<void>): void {
    it(name, {
      skip: process.platform === 'linux' ? false : unsupportedHandleContainmentReason,
    }, run);
  }

  function snapshotWithReadContent(content: string): RepoSnapshot {
    const file = {
      path: 'README.md',
      bytes: Buffer.byteLength(content, 'utf8'),
      content,
    };
    return {
      owner: 'RocketDelivery2',
      repo: 'github-copilot-jackhammer-service',
      baseBranch: 'main',
      commitSha: 'a'.repeat(40),
      generatedAt: new Date().toISOString(),
      fileCount: 1,
      files: [file],
      recentChanges: 'a'.repeat(40),
      packageHints: derivePackageHints([file]),
    };
  }

  itWithHandleVerifiedReads('excludes pem, key, and nested env files from text context', async () => {
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

  itWithHandleVerifiedReads('refuses symlinks escaping the repository root', async () => {
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

  itWithHandleVerifiedReads('skips ordinary binary files without reading them', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      await fs.writeFile(path.join(root, 'unexpected.bin'), Buffer.from([0, 1, 2, 3]));
      const snapshot = await snapshotRepo(root, git);
      assert.equal(snapshot.files.some(file => file.path === 'unexpected.bin'), false);
    });
  });

  itWithHandleVerifiedReads('skips very large unknown-extension files without reading them', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      const unknownFile = await fs.open(path.join(root, 'large.opaque'), 'w');
      try {
        await unknownFile.truncate(16 * 1024 * 1024);
      } finally {
        await unknownFile.close();
      }
      const snapshot = await snapshotRepo(root, git);
      assert.deepEqual(snapshot.files.map(file => file.path), ['README.md']);
    });
  });

  itWithHandleVerifiedReads('fails closed when a recognized text file is not valid UTF-8', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), Buffer.from([0xff, 0xfe, 0xfd]));
      await assert.rejects(() => snapshotRepo(root, git), /unsupported repository text encoding/);
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

  itWithHandleVerifiedReads('does not classify nested excluded files as repository context', async () => {
    await withFixture(async root => {
      await fs.mkdir(path.join(root, 'nested'));
      await fs.writeFile(path.join(root, 'nested', 'README.md'), '# Nested');
      await fs.writeFile(path.join(root, 'nested', '.env'), 'API_KEY=secret');
      const snapshot = await snapshotRepo(root, git);
      assert.equal(snapshot.files.some(file => file.path.includes('.env')), false);
    });
  });

  itWithHandleVerifiedReads('does not let nested ignore negation re-include hard-excluded paths', async () => {
    await withFixture(async root => {
      await fs.mkdir(path.join(root, 'nested'));
      await fs.writeFile(path.join(root, 'nested', '.gitignore'), 'secrets.txt\n!secrets.txt\n');
      await fs.writeFile(path.join(root, 'nested', 'secrets.txt'), 'not-for-context');
      await fs.writeFile(path.join(root, 'nested', 'README.md'), '# Safe nested docs');
      const snapshot = await snapshotRepo(root, git);
      assert.equal(snapshot.files.some(file => file.path.endsWith('secrets.txt')), false);
    });
  });

  itWithHandleVerifiedReads('rejects nested ignore files beyond the aggregate byte limit before provider invocation', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      const ignoreContent = '# x\n'.repeat(Math.floor(MAX_GITIGNORE_BYTES / 4));
      const ignoreFileCount = Math.floor(
        MAX_GITIGNORE_TOTAL_BYTES / Buffer.byteLength(ignoreContent, 'utf8'),
      ) + 1;
      await fs.writeFile(path.join(root, '.gitignore'), ignoreContent);

      let directory = root;
      for (let index = 1; index < ignoreFileCount; index += 1) {
        directory = path.join(directory, `nested-${index}`);
        await fs.mkdir(directory);
        await fs.writeFile(path.join(directory, '.gitignore'), ignoreContent);
      }

      const { createTasks } = await import('../openai.js');
      let providerCalls = 0;
      await assert.rejects(async () => {
        const snapshot = await snapshotRepo(root, git);
        await createTasks(snapshot, null, [], {
          responses: {
            create: async () => {
              providerCalls += 1;
              return { output_text: '{"tasks":[]}' };
            },
          },
        });
      }, /aggregate byte limit/);
      assert.equal(providerCalls, 0);
    });
  });

  itWithHandleVerifiedReads('does not derive package hints from an ignored package.json', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, '.gitignore'), 'package.json\n');
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      await fs.writeFile(path.join(root, 'package.json'), '{"name":"ignored"}');
      const snapshot = await snapshotRepo(root, git);
      assert.equal(snapshot.files.some(file => file.path === 'package.json'), false);
      assert.equal(snapshot.packageHints.some(hint => hint.startsWith('package.json:\n')), false);
    });
  });

  itWithHandleVerifiedReads('derives byte-bounded package hints from the validated snapshot files', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), `# Safe project\n${'é'.repeat(7_000)}`);
      const snapshot = await snapshotRepo(root, git);
      assert.equal(snapshot.packageHints.length, 1);
      assert.ok(Buffer.byteLength(snapshot.packageHints[0], 'utf8') <= 8_000);
      assert.match(snapshot.packageHints[0], /^README\.md:\n/);
      assert.match(snapshot.packageHints[0], /\[truncated\]$/);
    });
  });

  it('fails closed when a required ignore input is unreadable', async () => {
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      await fs.mkdir(path.join(root, '.gitignore'));
      await assert.rejects(() => snapshotRepo(root, git));
    });
  });

  itWithHandleVerifiedReads('detects replacement between path validation and opening', async () => {
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

  itWithHandleVerifiedReads('detects growth after the bounded read', async () => {
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

  itWithHandleVerifiedReads('rejects a parent-directory swap before final path resolution without calling the provider', async () => {
    await withFixture(async root => {
      const parentDirectory = path.join(root, 'nested');
      const file = path.join(parentDirectory, 'README.md');
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jackhammer-outside-parent-'));
      const movedDirectory = path.join(outsideRoot, 'nested');
      await fs.mkdir(parentDirectory);
      await fs.writeFile(file, 'outside directory content');

      const { createTasks } = await import('../openai.js');
      let providerCalls = 0;
      try {
        await assert.rejects(async () => {
          const buffer = await readBoundedRepositoryFile(root, file, 100, async stage => {
            if (stage === 'after-final-path-stat') {
              await fs.rename(parentDirectory, movedDirectory);
              await fs.symlink(movedDirectory, parentDirectory);
            }
            if (stage === 'before-final-path-resolution') {
              await fs.rm(parentDirectory, { recursive: true, force: true });
              await fs.rename(movedDirectory, parentDirectory);
            }
          });
          await createTasks(snapshotWithReadContent(buffer.toString('utf8')), null, [], {
            responses: {
              create: async () => {
                providerCalls += 1;
                return { output_text: '{"tasks":[]}' };
              },
            },
          });
        }, /repository path escapes the containment root/);
        assert.equal(providerCalls, 0);
      } finally {
        await fs.rm(parentDirectory, { recursive: true, force: true });
        await fs.rm(outsideRoot, { recursive: true, force: true });
      }
    });
  });

  it('fails closed before provider invocation when opened-handle containment is unsupported', async context => {
    if (process.platform === 'linux') {
      context.skip('Linux opened-handle containment is verified through /proc/self/fd');
      return;
    }
    await withFixture(async root => {
      await fs.writeFile(path.join(root, 'README.md'), '# Safe project');
      const { createTasks } = await import('../openai.js');
      let providerCalls = 0;
      await assert.rejects(async () => {
        const snapshot = await snapshotRepo(root, git);
        await createTasks(snapshot, null, [], {
          responses: {
            create: async () => {
              providerCalls += 1;
              return { output_text: '{"tasks":[]}' };
            },
          },
        });
      }, /opened-handle containment verification is unsupported on/);
      assert.equal(providerCalls, 0);
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
