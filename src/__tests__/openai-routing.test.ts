import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPromptCacheOptions,
  resolveOpenAIMaxOutputTokens,
  resolveOpenAIModel,
} from '../openai-routing.js';

describe('openai routing', () => {
  const config = {
    OPENAI_MODEL: 'gpt-5.6-terra',
    OPENAI_MODEL_QUEUE: 'gpt-5.6-terra',
    OPENAI_MODEL_CONTINUATION: 'gpt-5.6-luna',
    OPENAI_PROMPT_CACHE_ENABLED: true,
    OPENAI_PROMPT_CACHE_RETENTION: '24h',
    OPENAI_MAX_OUTPUT_TOKENS_QUEUE: 1200,
    OPENAI_MAX_OUTPUT_TOKENS_CONTINUATION: 256,
  } as const;

  it('routes queue generation to the higher-quality queue model and continuations to the cheaper continuation model', () => {
    assert.equal(resolveOpenAIModel(config, 'queue-generation'), 'gpt-5.6-terra');
    assert.equal(resolveOpenAIModel(config, 'continuation-comment'), 'gpt-5.6-luna');
  });

  it('uses bounded output token caps per operation', () => {
    assert.equal(resolveOpenAIMaxOutputTokens(config, 'queue-generation'), 1200);
    assert.equal(resolveOpenAIMaxOutputTokens(config, 'continuation-comment'), 256);
  });

  it('builds stable prompt cache keys and can be disabled', () => {
    const options = buildPromptCacheOptions(config, ['RocketDelivery2', 'github-copilot-jackhammer-service', 'main', 'queue-generation', 'gpt-5.6-terra']);
    assert.deepEqual(options, {
      prompt_cache_key: 'jackhammer-openai-v1:RocketDelivery2:github-copilot-jackhammer-service:main:queue-generation:gpt-5.6-terra',
      prompt_cache_retention: '24h',
    });

    assert.equal(buildPromptCacheOptions({ ...config, OPENAI_PROMPT_CACHE_ENABLED: false }, ['a']), undefined);
  });
});
