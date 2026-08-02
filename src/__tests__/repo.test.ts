import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildZipArchiveCommand } from '../repo.js';

describe('repo archive command selection', () => {
  it('uses PowerShell Compress-Archive on Windows', () => {
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

  it('uses zip on non-Windows platforms', () => {
    const command = buildZipArchiveCommand('linux', '/repo', '/tmp/repo.zip');

    assert.equal(command.command, 'zip');
    assert.deepEqual(command.args.slice(0, 4), ['-qr', '/tmp/repo.zip', '.', '-x']);
  });
});
