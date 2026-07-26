import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('repo archive command selection', () => {
  it('uses a PowerShell fallback on Windows hosts', async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGithubToken = process.env.GITHUB_TOKEN;

    try {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.GITHUB_TOKEN = 'test-github-token';

      const { buildZipCommand } = await import('../repo.js');
      const command = buildZipCommand('C:\\archive.zip', 'win32');

      assert.equal(command.command, 'powershell.exe');
      assert.deepEqual(command.args.slice(0, 3), ['-NoLogo', '-NoProfile', '-NonInteractive']);
      assert.match(command.args[4] ?? '', /Compress-Archive/);
      assert.match(command.args[4] ?? '', /\$archivePath = 'C:\\archive\.zip'/);
    } finally {
      restoreEnv('OPENAI_API_KEY', previousOpenAiKey);
      restoreEnv('GITHUB_TOKEN', previousGithubToken);
    }
  });

  it('uses the zip CLI on non-Windows hosts', async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGithubToken = process.env.GITHUB_TOKEN;

    try {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.GITHUB_TOKEN = 'test-github-token';

      const { buildZipCommand } = await import('../repo.js');
      const command = buildZipCommand('/tmp/archive.zip', 'linux');

      assert.equal(command.command, 'zip');
      assert.deepEqual(command.args, ['-qr', '/tmp/archive.zip', '.', '-x', '.git/*', 'node_modules/*', 'dist/*', 'build/*', '.env*']);
    } finally {
      restoreEnv('OPENAI_API_KEY', previousOpenAiKey);
      restoreEnv('GITHUB_TOKEN', previousGithubToken);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
