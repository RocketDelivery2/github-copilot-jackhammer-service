import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('repo archive command selection', () => {
  it('imports the pure archive helper without GitHub or provider credentials', async () => {
    const previousGithubToken = process.env.GITHUB_TOKEN;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;

    delete process.env.GITHUB_TOKEN;
    delete process.env.OPENAI_API_KEY;

    try {
      const { buildZipArchiveCommand } = await import('../repo.js');
      const command = buildZipArchiveCommand('linux', '/repo', '/tmp/repo.zip');

      assert.equal(command.command, 'zip');
    } finally {
      if (previousGithubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previousGithubToken;
      }

      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
    }
  });

  it('uses PowerShell Compress-Archive on Windows', async () => {
    const { buildZipArchiveCommand } = await import('../repo.js');
    const command = buildZipArchiveCommand(
      'win32',
      'C:\\Users\\Christopher Peterson\\Documents\\Codex\\jh-preview',
      'C:\\Users\\Christopher Peterson\\Documents\\Codex\\jh-preview\\.ai\\jackhammer-repo-main.zip',
    );

    assert.equal(command.command, 'powershell.exe');
    assert.ok(command.args.some(arg => arg.includes('Compress-Archive')));
    assert.ok(command.args.some(arg => arg.includes('.git')));
    assert.ok(command.args.some(arg => arg.includes('node_modules')));
  });

  it('uses zip on non-Windows platforms', async () => {
    const { buildZipArchiveCommand } = await import('../repo.js');
    const command = buildZipArchiveCommand('linux', '/repo', '/tmp/repo.zip');

    assert.equal(command.command, 'zip');
    assert.deepEqual(command.args.slice(0, 4), ['-qr', '/tmp/repo.zip', '.', '-x']);
  });
});
