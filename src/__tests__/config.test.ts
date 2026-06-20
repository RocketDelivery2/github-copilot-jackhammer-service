import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('config', () => {
  it('defaults ADAPTIVE_QUEUE_ENABLED to false', async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousGithubToken = process.env.GITHUB_TOKEN;

    try {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.GITHUB_TOKEN = 'test-github-token';
      const { parseConfig } = await import('../config.js');

      const parsed = parseConfig({
        OPENAI_API_KEY: 'test-openai-key',
        GITHUB_TOKEN: 'test-github-token',
      });
      const enabled = parseConfig({
        OPENAI_API_KEY: 'test-openai-key',
        GITHUB_TOKEN: 'test-github-token',
        ADAPTIVE_QUEUE_ENABLED: 'true',
      });

      assert.equal(parsed.ADAPTIVE_QUEUE_ENABLED, false);
      assert.equal(enabled.ADAPTIVE_QUEUE_ENABLED, true);
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
