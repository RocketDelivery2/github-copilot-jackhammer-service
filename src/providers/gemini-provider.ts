import { GoogleGenAI } from '@google/genai';
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

type GeminiUsageLike = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type GeminiResponseLike = {
  text?: string;
  responseId?: string;
  usageMetadata?: GeminiUsageLike;
};

type GeminiClientLike = {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: {
        maxOutputTokens?: number;
        abortSignal?: AbortSignal;
      };
    }): Promise<GeminiResponseLike>;
  };
};

export interface GeminiProviderOptions {
  client?: GeminiClientLike;
  apiKey?: string;
  resolveApiKey?: () => string | null | undefined;
  createClient?: (apiKey: string, timeoutMs: number) => GeminiClientLike;
}

export class GeminiProvider implements ProviderAdapter {
  readonly id = 'gemini' as const;

  constructor(private readonly options: GeminiProviderOptions = {}) {}

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
        const response = await client.models.generateContent({
          model: request.model.trim(),
          contents: request.prompt,
          config: {
            maxOutputTokens: request.maxOutputTokens,
            abortSignal: signal,
          },
        });

        const usage = response.usageMetadata;

        return createSuccessResult(
          this.id,
          request.model.trim(),
          response.text ?? '',
          elapsedMs(startedAt),
          response.responseId ?? null,
          usage?.promptTokenCount ?? null,
          usage?.candidatesTokenCount ?? null,
          usage?.totalTokenCount ?? null,
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
      normalizeCredential(process.env.GEMINI_API_KEY) ??
      normalizeCredential(process.env.GOOGLE_API_KEY)
    );
  }

  private resolveClient(apiKey: string, timeoutMs: number): GeminiClientLike {
    if (this.options.client) {
      return this.options.client;
    }

    if (this.options.createClient) {
      return this.options.createClient(apiKey, timeoutMs);
    }

    const client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: timeoutMs,
      },
    });

    return client as unknown as GeminiClientLike;
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}
