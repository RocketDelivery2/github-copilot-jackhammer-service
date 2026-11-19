import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repositoryRoot = process.cwd();
const cliPath = fileURLToPath(new URL('../discussion-writer-cli.ts', import.meta.url));

describe('discussion writer CLI', () => {
  it('disabled mode exits without requiring API credentials', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DISCUSSIONS_ENABLED: 'false',
        OPENAI_API_KEY: '',
        GITHUB_TOKEN: '',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Discussion generation is disabled by configuration\./);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /ZodError|OPENAI_API_KEY|GITHUB_TOKEN/);
  });
});
