import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('config', () => {
  it('defaults adaptive preview settings safely', async () => {
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
      assert.equal(parsed.GITHUB_REPO, 'github-copilot-jackhammer-service');
      assert.equal(parsed.REPO_URL, 'https://github.com/RocketDelivery2/github-copilot-jackhammer-service.git');
      assert.equal(parsed.OPENAI_MODEL, 'gpt-5.6-terra');
      assert.equal(parsed.OPENAI_MODEL_QUEUE, 'gpt-5.6-terra');
      assert.equal(parsed.OPENAI_MODEL_CONTINUATION, 'gpt-5.6-luna');
      assert.equal(parsed.OPENAI_PROMPT_CACHE_ENABLED, true);
      assert.equal(parsed.OPENAI_PROMPT_CACHE_RETENTION, '24h');
      assert.equal(parsed.OPENAI_MAX_OUTPUT_TOKENS_QUEUE, 1200);
      assert.equal(parsed.OPENAI_MAX_OUTPUT_TOKENS_CONTINUATION, 256);
      assert.equal(parsed.ADAPTIVE_EVENT_JOURNAL_PATH, '.ai/adaptive-preview-event-journal.json');
      assert.equal(parsed.ADAPTIVE_EVENT_JOURNAL_RETENTION, 200);
      assert.equal(parsed.ADAPTIVE_PREVIEW_CAPTURE_SOURCE, 'recent-results');
      assert.equal(parsed.ADAPTIVE_PREVIEW_CAPTURE_LIMIT, 3);
      assert.equal(parsed.ADAPTIVE_PREVIEW_VALIDATION_PROBES, '');
      assert.equal(parsed.ADAPTIVE_PREVIEW_DECISION_INPUTS_FILE, '');
      assert.equal(parsed.ADAPTIVE_PREVIEW_APPROVAL_STATE_FILE, '');
      assert.equal(enabled.ADAPTIVE_QUEUE_ENABLED, true);
    } finally {
      restoreEnv('OPENAI_API_KEY', previousOpenAiKey);
      restoreEnv('GITHUB_TOKEN', previousGithubToken);
    }
  });

  it('rejects invalid ADAPTIVE_PREVIEW_CAPTURE_SOURCE', async () => {
    const { parseConfig } = await import('../config.js');

    assert.throws(() => parseConfig({
      OPENAI_API_KEY: 'test-openai-key',
      GITHUB_TOKEN: 'test-github-token',
      ADAPTIVE_PREVIEW_CAPTURE_SOURCE: 'unknown-source',
    }));
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

