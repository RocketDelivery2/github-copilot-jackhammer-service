import OpenAI from 'openai';
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

type OpenAIResponseUsageLike = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

type OpenAIResponseLike = {
  output_text?: string;
  usage?: OpenAIResponseUsageLike;
};

type OpenAIRequestResultLike = {
  withResponse(): Promise<{
    data: OpenAIResponseLike;
    request_id: string | null;
  }>;
} | Promise<{
  output_text?: string | null;
  usage?: OpenAIResponseUsageLike | null;
  _request_id?: string | null;
  request_id?: string | null;
}>;

type OpenAIClientLike = {
  responses: {
    create(
      params: {
        model: string;
        input: string;
        max_output_tokens: number;
      },
      options?: {
        signal?: AbortSignal;
      },
    ): OpenAIRequestResultLike;
  };
};

export interface OpenAIProviderOptions {
  client?: OpenAIClientLike;
  apiKey?: string;
  resolveApiKey?: () => string | null | undefined;
  createClient?: (apiKey: string, timeoutMs: number) => OpenAIClientLike;
}

export class OpenAIProvider implements ProviderAdapter {
  readonly id = 'openai' as const;

  constructor(private readonly options: OpenAIProviderOptions = {}) {}

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
        const rawResponse = await client.responses.create(
          {
            model: request.model.trim(),
            input: request.prompt,
            max_output_tokens: request.maxOutputTokens,
          },
          { signal },
        );
        const response = await resolveOpenAIResponse(rawResponse);

        const data = response.data;
        const usage = data.usage;

        return createSuccessResult(
          this.id,
          request.model.trim(),
          data.output_text ?? '',
          elapsedMs(startedAt),
          response.request_id ?? null,
          usage?.input_tokens ?? null,
          usage?.output_tokens ?? null,
          usage?.total_tokens ?? null,
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
      normalizeCredential(process.env.OPENAI_API_KEY)
    );
  }

  private resolveClient(apiKey: string, timeoutMs: number): OpenAIClientLike {
    if (this.options.client) {
      return this.options.client;
    }

    if (this.options.createClient) {
      return this.options.createClient(apiKey, timeoutMs);
    }

    const client = new OpenAI({ apiKey });
    return client as unknown as OpenAIClientLike;
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

async function resolveOpenAIResponse(response: unknown): Promise<{
  data: OpenAIResponseLike;
  request_id: string | null;
}> {
  if (hasWithResponse(response)) {
    return response.withResponse();
  }

  const raw = await response;
  return {
    data: {
      output_text: readOptionalString(raw, 'output_text') ?? undefined,
      usage: readOptionalObject(raw, 'usage') as OpenAIResponseUsageLike | undefined,
    },
    request_id: readOptionalString(raw, 'request_id') ?? readOptionalString(raw, '_request_id'),
  };
}

function hasWithResponse(
  value: unknown,
): value is {
  withResponse(): Promise<{
    data: OpenAIResponseLike;
    request_id: string | null;
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

function readOptionalObject(value: unknown, key: string): object | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }

  const candidate = Reflect.get(value, key);
  return candidate && typeof candidate === 'object' ? candidate : null;
}
