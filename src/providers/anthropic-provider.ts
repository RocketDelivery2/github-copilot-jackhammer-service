import Anthropic from '@anthropic-ai/sdk';
import {
  createFailureResult,
  createSuccessResult,
  normalizeCredential,
  normalizeProviderErrorCode,
  normalizeText,
  type ProviderAdapter,
  type ProviderRequest,
  type ProviderResult,
  validateProviderRequest,
  withTimeout,
} from './types.js';

type AnthropicUsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
};

type AnthropicTextBlockLike = {
  type?: string;
  text?: string;
};

type AnthropicMessageLike = {
  content?: Array<AnthropicTextBlockLike>;
  usage?: AnthropicUsageLike;
};

type AnthropicRequestResultLike = {
  withResponse(): Promise<{
    data: AnthropicMessageLike;
    request_id: string | null | undefined;
  }>;
} | Promise<{
  id?: string;
  _request_id?: string | null;
  request_id?: string | null;
  content?: Array<AnthropicTextBlockLike>;
  usage?: AnthropicUsageLike | null;
}>;

type AnthropicClientLike = {
  messages: {
    create(
      params: {
        model: string;
        max_tokens: number;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      },
      options?: {
        signal?: AbortSignal;
      },
    ): AnthropicRequestResultLike;
  };
};

export interface AnthropicProviderOptions {
  client?: AnthropicClientLike;
  apiKey?: string;
  resolveApiKey?: () => string | null | undefined;
  createClient?: (apiKey: string, timeoutMs: number) => AnthropicClientLike;
}

export class AnthropicProvider implements ProviderAdapter {
  readonly id = 'anthropic' as const;

  constructor(private readonly options: AnthropicProviderOptions = {}) {}

  async invoke(request: ProviderRequest): Promise<ProviderResult> {
    const startedAt = Date.now();
    const model = normalizeText(request?.model);

    try {
      validateProviderRequest(request);
    } catch (error) {
      return createFailureResult(this.id, model, elapsedMs(startedAt), normalizeProviderErrorCode(error));
    }

    try {
      const apiKey = this.resolveApiKey();
      if (!apiKey) {
        return createFailureResult(this.id, model, elapsedMs(startedAt), 'missing_credential');
      }

      const client = this.resolveClient(apiKey, request.timeoutMs);

      return await withTimeout(request.timeoutMs, async (signal) => {
        const rawResponse = await client.messages.create(
          {
            model: request.model.trim(),
            max_tokens: request.maxOutputTokens,
            messages: [{ role: 'user', content: request.prompt }],
          },
          { signal },
        );
        const response = await resolveAnthropicResponse(rawResponse);

        const data = response.data;
        const usage = data.usage;

        return createSuccessResult(
          this.id,
          request.model.trim(),
          extractAnthropicText(data.content),
          elapsedMs(startedAt),
          response.request_id ?? null,
          usage?.input_tokens ?? null,
          usage?.output_tokens ?? null,
          sumNullableTokens(usage?.input_tokens ?? null, usage?.output_tokens ?? null),
        );
      });
    } catch (error) {
      return createFailureResult(this.id, model, elapsedMs(startedAt), normalizeProviderErrorCode(error));
    }
  }

  private resolveApiKey(): string | null {
    return (
      normalizeCredential(this.options.apiKey) ??
      normalizeCredential(this.options.resolveApiKey?.()) ??
      normalizeCredential(process.env.ANTHROPIC_API_KEY)
    );
  }

  private resolveClient(apiKey: string, timeoutMs: number): AnthropicClientLike {
    if (this.options.client) {
      return this.options.client;
    }

    if (this.options.createClient) {
      return this.options.createClient(apiKey, timeoutMs);
    }

    const client = new Anthropic({ apiKey });
    return client as unknown as AnthropicClientLike;
  }
}

function extractAnthropicText(content: Array<AnthropicTextBlockLike> | undefined): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('');
}

function sumNullableTokens(inputTokens: number | null, outputTokens: number | null): number | null {
  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  return inputTokens + outputTokens;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

async function resolveAnthropicResponse(response: unknown): Promise<{
  data: AnthropicMessageLike;
  request_id: string | null | undefined;
}> {
  if (hasWithResponse(response)) {
    return response.withResponse();
  }

  const raw = await response;
  return {
    data: {
      content: readOptionalArray(raw, 'content'),
      usage: readOptionalObject(raw, 'usage') as AnthropicUsageLike | undefined,
    },
    request_id: readOptionalString(raw, 'request_id') ?? readOptionalString(raw, '_request_id'),
  };
}

function hasWithResponse(
  value: unknown,
): value is {
  withResponse(): Promise<{
    data: AnthropicMessageLike;
    request_id: string | null | undefined;
  }>;
} {
  return Boolean(value) && value !== null && typeof value === 'object' && typeof Reflect.get(value, 'withResponse') === 'function';
}

function readOptionalString(value: unknown, key: string): string | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }

  const candidate = Reflect.get(value, key);
  return typeof candidate === 'string' ? candidate : null;
}

function readOptionalArray(value: unknown, key: string): Array<AnthropicTextBlockLike> | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  const candidate = Reflect.get(value, key);
  return Array.isArray(candidate) ? (candidate as Array<AnthropicTextBlockLike>) : undefined;
}

function readOptionalObject(value: unknown, key: string): object | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }

  const candidate = Reflect.get(value, key);
  return candidate && typeof candidate === 'object' ? candidate : null;
}
