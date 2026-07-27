import type { AppConfig } from './config.js';

export type OpenAIOperation = 'queue-generation' | 'continuation-comment';

type PromptCacheConfig = Pick<AppConfig, 'OPENAI_PROMPT_CACHE_ENABLED' | 'OPENAI_PROMPT_CACHE_RETENTION'>;
type ModelConfig = Pick<
  AppConfig,
  'OPENAI_MODEL' | 'OPENAI_MODEL_QUEUE' | 'OPENAI_MODEL_CONTINUATION' |
  'OPENAI_MAX_OUTPUT_TOKENS_QUEUE' | 'OPENAI_MAX_OUTPUT_TOKENS_CONTINUATION'
>;

const CACHE_PREFIX = 'jackhammer-openai-v1';

export function resolveOpenAIModel(config: ModelConfig, operation: OpenAIOperation): string {
  if (operation === 'queue-generation') {
    return config.OPENAI_MODEL_QUEUE || config.OPENAI_MODEL;
  }

  return config.OPENAI_MODEL_CONTINUATION || config.OPENAI_MODEL;
}

export function resolveOpenAIMaxOutputTokens(config: ModelConfig, operation: OpenAIOperation): number {
  if (operation === 'queue-generation') {
    return config.OPENAI_MAX_OUTPUT_TOKENS_QUEUE;
  }

  return config.OPENAI_MAX_OUTPUT_TOKENS_CONTINUATION;
}

export function buildPromptCacheOptions(
  config: PromptCacheConfig,
  scopeParts: readonly string[],
): { prompt_cache_key: string; prompt_cache_retention: 'in_memory' | '24h' } | undefined {
  if (!config.OPENAI_PROMPT_CACHE_ENABLED) {
    return undefined;
  }

  return {
    prompt_cache_key: [CACHE_PREFIX, ...scopeParts.map(normalizeSegment)].join(':'),
    prompt_cache_retention: config.OPENAI_PROMPT_CACHE_RETENTION,
  };
}

function normalizeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
