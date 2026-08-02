import { AnthropicProvider, type AnthropicProviderOptions } from './anthropic-provider.js';
import { GeminiProvider, type GeminiProviderOptions } from './gemini-provider.js';
import { OpenAIProvider, type OpenAIProviderOptions } from './openai-provider.js';
import type { ProviderAdapter, ProviderId } from './types.js';

export interface ProviderRegistryOptions {
  openai?: ProviderAdapter | OpenAIProviderOptions;
  anthropic?: ProviderAdapter | AnthropicProviderOptions;
  gemini?: ProviderAdapter | GeminiProviderOptions;
  openaiOptions?: OpenAIProviderOptions;
  anthropicOptions?: AnthropicProviderOptions;
  geminiOptions?: GeminiProviderOptions;
}

export interface ProviderRegistry {
  openai: ProviderAdapter;
  anthropic: ProviderAdapter;
  gemini: ProviderAdapter;
  get(providerId: string): ProviderAdapter;
  list(): ProviderId[];
}

export function createProviderRegistry(options: ProviderRegistryOptions = {}): ProviderRegistry {
  const adapters: Record<ProviderId, ProviderAdapter> = {
    openai: resolveAdapter(options.openai, options.openaiOptions, OpenAIProvider),
    anthropic: resolveAdapter(options.anthropic, options.anthropicOptions, AnthropicProvider),
    gemini: resolveAdapter(options.gemini, options.geminiOptions, GeminiProvider),
  };

  return {
    openai: adapters.openai,
    anthropic: adapters.anthropic,
    gemini: adapters.gemini,
    get(providerId: string): ProviderAdapter {
      if (providerId === 'openai' || providerId === 'anthropic' || providerId === 'gemini') {
        return adapters[providerId];
      }

      throw new Error(`Unsupported provider: ${providerId}`);
    },
    list(): ProviderId[] {
      return ['openai', 'anthropic', 'gemini'];
    },
  };
}

export const providerRegistry = createProviderRegistry();

export function resolveProvider(registry: ProviderRegistry, providerId: ProviderId): ProviderAdapter {
  return registry.get(providerId);
}

function resolveAdapter<TOptions>(
  adapterOrOptions: ProviderAdapter | TOptions | undefined,
  defaultOptions: TOptions | undefined,
  ProviderCtor: new (options?: TOptions) => ProviderAdapter,
): ProviderAdapter {
  if (isProviderAdapter(adapterOrOptions)) {
    return adapterOrOptions;
  }

  if (defaultOptions !== null && isProviderAdapter(defaultOptions)) {
    return defaultOptions;
  }

  if (adapterOrOptions !== null && typeof adapterOrOptions === 'object') {
    return new ProviderCtor(adapterOrOptions as TOptions);
  }

  if (defaultOptions !== null && typeof defaultOptions === 'object') {
    return new ProviderCtor(defaultOptions as TOptions);
  }

  return new ProviderCtor();
}

function isProviderAdapter(value: unknown): value is ProviderAdapter {
  return Boolean(value) && value !== null && typeof value === 'object' && typeof Reflect.get(value, 'invoke') === 'function';
}
