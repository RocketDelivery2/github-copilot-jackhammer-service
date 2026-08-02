import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProviderId, ProviderRequest, ProviderResult } from './types.js';

test('providers import without any provider credentials present', async () => {
  await withEnv(
    {
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    },
    async () => {
      await import('./openai-provider.js');
      await import('./anthropic-provider.js');
      await import('./gemini-provider.js');
      await import('./registry.js');
    },
  );
});

test('registry selects the exact provider and rejects unknown providers', async () => {
  const { createProviderRegistry } = await import('./registry.js');

  const calls: ProviderId[] = [];
  const openai = createMockAdapter('openai', calls);
  const anthropic = createMockAdapter('anthropic', calls);
  const gemini = createMockAdapter('gemini', calls);
  const registry = createProviderRegistry({ openai, anthropic, gemini });

  assert.equal(registry.get('openai'), openai);
  assert.equal(registry.get('anthropic'), anthropic);
  assert.equal(registry.get('gemini'), gemini);
  assert.deepEqual(registry.list(), ['openai', 'anthropic', 'gemini']);
  assert.throws(() => registry.get('mistral' as ProviderId), /Unsupported provider/i);
});

test('request validation rejects invalid inputs before any client resolution', async () => {
  const { OpenAIProvider } = await import('./openai-provider.js');
  let clientFactoryCalls = 0;
  let credentialResolverCalls = 0;
  const provider = new OpenAIProvider({
    resolveApiKey: () => {
      credentialResolverCalls += 1;
      return 'should-not-be-needed';
    },
    createClient: () => {
      clientFactoryCalls += 1;
      return createOpenAIMockClient();
    },
  });

  const result = await provider.invoke({
    prompt: '   ',
    model: '',
    maxOutputTokens: 0,
    timeoutMs: 0,
  } as ProviderRequest);

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'invalid_request');
  assert.equal(clientFactoryCalls, 0);
  assert.equal(credentialResolverCalls, 0);
});

test('missing credential behavior is normalized without throwing', async () => {
  const { AnthropicProvider } = await import('./anthropic-provider.js');
  const provider = new AnthropicProvider({
    client: createAnthropicMockClient(),
  });

  await withEnv(
    {
      ANTHROPIC_API_KEY: undefined,
    },
    async () => {
      const result = await provider.invoke({
        prompt: 'Hello, Claude',
        model: 'claude-sonnet-4-6',
        maxOutputTokens: 64,
        timeoutMs: 1_000,
      });

      assert.equal(result.success, false);
      assert.equal(result.errorCode, 'missing_credential');
      assert.equal(result.requestId, null);
    },
  );
});

test('credential resolution is lazy and only occurs during invoke()', async () => {
  const { GeminiProvider } = await import('./gemini-provider.js');

  let credentialResolverCalls = 0;
  let clientFactoryCalls = 0;
  const provider = new GeminiProvider({
    resolveApiKey: () => {
      credentialResolverCalls += 1;
      return 'test-gemini-key';
    },
    createClient: () => {
      clientFactoryCalls += 1;
      return createGeminiMockClient({
        text: 'lazy-load-ok',
        responseId: 'gemini-request-1',
        usageMetadata: {
          promptTokenCount: 7,
          candidatesTokenCount: 9,
          totalTokenCount: 16,
        },
      });
    },
  });

  assert.equal(credentialResolverCalls, 0);

  const result = await provider.invoke({
    prompt: 'Return a short acknowledgement.',
    model: 'gemini-3.5-flash-lite',
    maxOutputTokens: 32,
    timeoutMs: 1_000,
  });

  assert.equal(result.success, true);
  assert.equal(result.text, 'lazy-load-ok');
  assert.equal(credentialResolverCalls, 1);
  assert.equal(clientFactoryCalls, 1);
});

test('successful normalized result is returned for OpenAI mock client', async () => {
  const { OpenAIProvider } = await import('./openai-provider.js');
  const provider = new OpenAIProvider({
    apiKey: 'test-openai-key',
    createClient: () =>
      createOpenAIMockClient({
        output_text: 'openai-ok',
        usage: {
          input_tokens: 11,
          output_tokens: 13,
          total_tokens: 24,
        },
      }),
  });

  const result = await provider.invoke({
    prompt: 'Return openai ok.',
    model: 'gpt-5-nano-2025-08-07',
    maxOutputTokens: 16,
    timeoutMs: 1_000,
  });

  assert.equal(result.success, true);
  assert.equal(result.provider, 'openai');
  assert.equal(result.model, 'gpt-5-nano-2025-08-07');
  assert.equal(result.text, 'openai-ok');
  assert.equal(result.inputTokens, 11);
  assert.equal(result.outputTokens, 13);
  assert.equal(result.totalTokens, 24);
  assert.equal(result.estimatedCostUsd, null);
  assert.equal(result.requestId, 'openai-request-1');
});

test('successful normalized result is returned for Anthropic mock client', async () => {
  const { AnthropicProvider } = await import('./anthropic-provider.js');
  const provider = new AnthropicProvider({
    apiKey: 'test-anthropic-key',
    createClient: () =>
      createAnthropicMockClient({
        content: [{ type: 'text', text: 'anthropic-ok' }],
        usage: {
          input_tokens: 21,
          output_tokens: 34,
        },
      }),
  });

  const result = await provider.invoke({
    prompt: 'Return anthropic ok.',
    model: 'claude-sonnet-4-6',
    maxOutputTokens: 48,
    timeoutMs: 1_000,
  });

  assert.equal(result.success, true);
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.text, 'anthropic-ok');
  assert.equal(result.inputTokens, 21);
  assert.equal(result.outputTokens, 34);
  assert.equal(result.totalTokens, 55);
  assert.equal(result.requestId, 'anthropic-request-1');
});

test('successful normalized result is returned for Gemini mock client', async () => {
  const { GeminiProvider } = await import('./gemini-provider.js');
  const provider = new GeminiProvider({
    apiKey: 'test-gemini-key',
    createClient: () =>
      createGeminiMockClient({
        text: 'gemini-ok',
        responseId: 'gemini-response-1',
        usageMetadata: {
          promptTokenCount: 4,
          candidatesTokenCount: 6,
          totalTokenCount: 10,
        },
      }),
  });

  const result = await provider.invoke({
    prompt: 'Return gemini ok.',
    model: 'gemini-3.5-flash-lite',
    maxOutputTokens: 32,
    timeoutMs: 1_000,
  });

  assert.equal(result.success, true);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.text, 'gemini-ok');
  assert.equal(result.inputTokens, 4);
  assert.equal(result.outputTokens, 6);
  assert.equal(result.totalTokens, 10);
  assert.equal(result.requestId, 'gemini-response-1');
});

test('API failures normalize without leaking secrets', async () => {
  const { OpenAIProvider } = await import('./openai-provider.js');
  const leakedSecret = 'sk-test-secret-1234567890';
  const provider = new OpenAIProvider({
    apiKey: leakedSecret,
    createClient: () => createOpenAIMockClient({}, { throwWith: Object.assign(new Error(`Unauthorized ${leakedSecret}`), { status: 401, code: 'invalid_api_key' }) }),
  });

  const result = await provider.invoke({
    prompt: 'Return failure.',
    model: 'gpt-5-nano-2025-08-07',
    maxOutputTokens: 16,
    timeoutMs: 1_000,
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'auth_error');
  assert.equal(JSON.stringify(result).includes(leakedSecret), false);
});

test('timeout failures normalize without leaking secrets', async () => {
  const { AnthropicProvider } = await import('./anthropic-provider.js');
  const provider = new AnthropicProvider({
    apiKey: 'test-anthropic-key',
    createClient: () =>
      createAnthropicMockClient({}, {
        waitForAbort: true,
      }),
  });

  const result = await provider.invoke({
    prompt: 'Please time out.',
    model: 'claude-sonnet-4-6',
    maxOutputTokens: 16,
    timeoutMs: 25,
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'timeout');
  assert.equal(result.requestId, null);
});

test('Gemini prefers GEMINI_API_KEY and falls back to GOOGLE_API_KEY', async () => {
  const { GeminiProvider } = await import('./gemini-provider.js');
  const observedKeys: string[] = [];

  await withEnv(
    {
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: 'google-fallback-key',
    },
    async () => {
      const provider = new GeminiProvider({
        createClient: (apiKey) => {
          observedKeys.push(apiKey);
          return createGeminiMockClient({
            text: 'fallback-ok',
            responseId: 'gemini-response-2',
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 2,
              totalTokenCount: 3,
            },
          });
        },
      });

      const result = await provider.invoke({
        prompt: 'Return fallback ok.',
        model: 'gemini-3.5-flash-lite',
        maxOutputTokens: 8,
        timeoutMs: 1_000,
      });

      assert.equal(result.success, true);
    },
  );

  assert.deepEqual(observedKeys, ['google-fallback-key']);
});

test('injected credentials override environment credentials', async () => {
  const { OpenAIProvider } = await import('./openai-provider.js');
  const observedKeys: string[] = [];

  await withEnv(
    {
      OPENAI_API_KEY: 'env-openai-key',
    },
    async () => {
      const provider = new OpenAIProvider({
        apiKey: 'injected-openai-key',
        createClient: (apiKey) => {
          observedKeys.push(apiKey);
          return createOpenAIMockClient({
            output_text: 'override-ok',
            usage: {
              input_tokens: 5,
              output_tokens: 7,
              total_tokens: 12,
            },
          });
        },
      });

      const result = await provider.invoke({
        prompt: 'Return override ok.',
        model: 'gpt-5-nano-2025-08-07',
        maxOutputTokens: 16,
        timeoutMs: 1_000,
      });

      assert.equal(result.success, true);
    },
  );

  assert.deepEqual(observedKeys, ['injected-openai-key']);
});

test('the CLI parses arguments and formats normalized JSON without echoing prompt text', async () => {
  const { runProviderTestCli, parseProviderTestArgs } = await import('../cli/provider-test.js');

  const parsed = parseProviderTestArgs([
    '--provider',
    'openai',
    '--model',
    'gpt-5-nano-2025-08-07',
    '--prompt',
    'hello world',
    '--max-output-tokens',
    '8',
    '--timeout-ms',
    '1234',
  ]);

  assert.equal(parsed.provider, 'openai');
  assert.equal(parsed.model, 'gpt-5-nano-2025-08-07');
  assert.equal(parsed.prompt, 'hello world');
  assert.equal(parsed.maxOutputTokens, 8);
  assert.equal(parsed.timeoutMs, 1234);
  assert.equal(parsed.showText, false);

  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runProviderTestCli(
    ['--provider', 'openai', '--model', 'gpt-5-nano-2025-08-07', '--prompt', 'hello world'],
    {
      registry: {
        openai: createMockAdapter('openai'),
        anthropic: createMockAdapter('anthropic'),
        gemini: createMockAdapter('gemini'),
        get: () => createMockAdapter('openai'),
        list: () => ['openai', 'anthropic', 'gemini'],
      },
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.match(stdout.join(''), /"responseTextLength"/);
  assert.doesNotMatch(stdout.join(''), /hello world/);
});

test('the CLI exits 2 for invalid arguments', async () => {
  const { runProviderTestCli } = await import('../cli/provider-test.js');

  const stderr: string[] = [];
  const exitCode = await runProviderTestCli(['--provider', 'openai', '--model', 'gpt-5-nano-2025-08-07'], {
    writeStdout: () => undefined,
    writeStderr: (text) => stderr.push(text),
  });

  assert.equal(exitCode, 2);
  assert.match(stderr.join(''), /Missing required --prompt/i);
});

test('automatic fallback to a different provider is not performed', async () => {
  const { createProviderRegistry } = await import('./registry.js');
  let openaiCalls = 0;
  let anthropicCalls = 0;
  let geminiCalls = 0;

  const registry = createProviderRegistry({
    openai: createMockAdapter('openai', undefined, () => {
      openaiCalls += 1;
      return successResult('openai', 'gpt-5-nano-2025-08-07', 'openai-only');
    }),
    anthropic: createMockAdapter('anthropic', undefined, () => {
      anthropicCalls += 1;
      return successResult('anthropic', 'claude-sonnet-4-6', 'anthropic-only');
    }),
    gemini: createMockAdapter('gemini', undefined, () => {
      geminiCalls += 1;
      return successResult('gemini', 'gemini-3.5-flash-lite', 'gemini-only');
    }),
  });

  const adapter = registry.get('anthropic');
  const result = await adapter.invoke({
    prompt: 'Run exact provider.',
    model: 'claude-sonnet-4-6',
    maxOutputTokens: 8,
    timeoutMs: 1_000,
  });

  assert.equal(result.success, true);
  assert.equal(openaiCalls, 0);
  assert.equal(anthropicCalls, 1);
  assert.equal(geminiCalls, 0);
});

function createMockAdapter(
  provider: ProviderId,
  callLog?: ProviderId[],
  resultFactory: (request: ProviderRequest) => ProviderResult = (request) =>
    successResult(provider, request.model, `${provider}-ok`),
): { id: ProviderId; invoke(request: ProviderRequest): Promise<ProviderResult> } {
  return {
    id: provider,
    async invoke(request: ProviderRequest): Promise<ProviderResult> {
      callLog?.push(provider);
      return resultFactory(request);
    },
  };
}

function successResult(provider: ProviderId, model: string, text: string): ProviderResult {
  return {
    provider,
    model,
    text,
    success: true,
    inputTokens: 1,
    outputTokens: 2,
    totalTokens: 3,
    estimatedCostUsd: null,
    latencyMs: 1,
    requestId: `${provider}-request-1`,
    errorCode: null,
  };
}

function createOpenAIMockClient(
  response: Partial<{ output_text: string; usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }> = {},
  behavior: { throwWith?: Error } = {},
): {
  responses: {
    create(
      params: { model: string; input: string; max_output_tokens: number },
      options?: { signal?: AbortSignal },
    ): {
      withResponse(): Promise<{
        data: { output_text?: string; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } };
        request_id: string | null;
      }>;
    };
  };
} {
  return {
    responses: {
      create: () => ({
        withResponse: async () => {
          if (behavior.throwWith) {
            throw behavior.throwWith;
          }

          return {
            data: {
              output_text: response.output_text ?? 'openai-text',
              usage: response.usage,
            },
            request_id: 'openai-request-1',
          };
        },
      }),
    },
  };
}

function createAnthropicMockClient(
  response: Partial<{
    content: Array<{ type?: string; text?: string }>;
    usage: { input_tokens?: number | null; output_tokens?: number | null };
  }> = {},
  behavior: { waitForAbort?: boolean } = {},
): {
  messages: {
    create(
      params: { model: string; max_tokens: number; messages: Array<{ role: 'user' | 'assistant'; content: string }> },
      options?: { signal?: AbortSignal },
    ): {
      withResponse(): Promise<{
        data: { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number | null; output_tokens?: number | null } };
        request_id: string | null | undefined;
      }>;
    };
  };
} {
  return {
    messages: {
      create: (_params, options) => ({
        withResponse: async () => {
          if (behavior.waitForAbort) {
            await new Promise<never>((_, reject) => {
              options?.signal?.addEventListener(
                'abort',
                () => {
                  reject(new Error('aborted'));
                },
                { once: true },
              );
            });
          }

          return {
            data: {
              content: response.content ?? [{ type: 'text', text: 'anthropic-text' }],
              usage: response.usage,
            },
            request_id: 'anthropic-request-1',
          };
        },
      }),
    },
  };
}

function createGeminiMockClient(
  response: Partial<{
    text: string;
    responseId: string;
    usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  }> = {},
): {
  models: {
    generateContent(params: { model: string; contents: string; config?: { maxOutputTokens?: number } }): Promise<{
      text?: string;
      responseId?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    }>;
  };
} {
  return {
    models: {
      generateContent: async () => ({
        text: response.text ?? 'gemini-text',
        responseId: response.responseId ?? 'gemini-response-1',
        usageMetadata: response.usageMetadata,
      }),
    },
  };
}

async function withEnv<T>(overrides: Record<string, string | undefined>, action: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
  }

  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return await action();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
