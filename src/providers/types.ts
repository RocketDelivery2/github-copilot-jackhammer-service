export type ProviderId = 'openai' | 'anthropic' | 'gemini';

export type ProviderRequest = {
  prompt: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
};

export type ProviderResult = {
  provider: ProviderId;
  model: string;
  text: string;
  success: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number;
  requestId: string | null;
  errorCode: string | null;
};

export interface ProviderAdapter {
  readonly id: ProviderId;
  invoke(request: ProviderRequest): Promise<ProviderResult>;
}

export const PROVIDER_LIMITS = {
  maxPromptLength: 100_000,
  maxModelLength: 128,
  maxOutputTokens: 32_768,
  maxTimeoutMs: 600_000,
} as const;

export type ProviderErrorCode =
  | 'invalid_request'
  | 'missing_credential'
  | 'timeout'
  | 'auth_error'
  | 'rate_limited'
  | 'provider_error'
  | 'unknown_error';

export class ProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderValidationError';
  }
}

export class ProviderTimeoutError extends Error {
  constructor(message = 'Provider request timed out') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export function normalizeCredential(value: string | undefined | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateProviderRequest(request: ProviderRequest): void {
  if (!request || typeof request !== 'object') {
    throw new ProviderValidationError('Provider request is required.');
  }

  const prompt = normalizeText(request.prompt);
  if (!prompt) {
    throw new ProviderValidationError('Prompt must be a non-empty string.');
  }

  if (prompt.length > PROVIDER_LIMITS.maxPromptLength) {
    throw new ProviderValidationError(`Prompt must be ${PROVIDER_LIMITS.maxPromptLength} characters or fewer.`);
  }

  const model = normalizeText(request.model);
  if (!model) {
    throw new ProviderValidationError('Model must be a non-empty string.');
  }

  if (model.length > PROVIDER_LIMITS.maxModelLength) {
    throw new ProviderValidationError(`Model must be ${PROVIDER_LIMITS.maxModelLength} characters or fewer.`);
  }

  if (!isPositiveInteger(request.maxOutputTokens)) {
    throw new ProviderValidationError('maxOutputTokens must be a positive integer.');
  }

  if (request.maxOutputTokens > PROVIDER_LIMITS.maxOutputTokens) {
    throw new ProviderValidationError(`maxOutputTokens must be ${PROVIDER_LIMITS.maxOutputTokens} or fewer.`);
  }

  if (!isPositiveInteger(request.timeoutMs)) {
    throw new ProviderValidationError('timeoutMs must be a positive integer.');
  }

  if (request.timeoutMs > PROVIDER_LIMITS.maxTimeoutMs) {
    throw new ProviderValidationError(`timeoutMs must be ${PROVIDER_LIMITS.maxTimeoutMs} or fewer.`);
  }
}

export function createFailureResult(
  provider: ProviderId,
  model: string,
  latencyMs: number,
  errorCode: ProviderErrorCode,
): ProviderResult {
  return {
    provider,
    model,
    text: '',
    success: false,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCostUsd: null,
    latencyMs,
    requestId: null,
    errorCode,
  };
}

export function createSuccessResult(
  provider: ProviderId,
  model: string,
  text: string,
  latencyMs: number,
  requestId: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
  totalTokens: number | null,
): ProviderResult {
  return {
    provider,
    model,
    text,
    success: true,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: null,
    latencyMs,
    requestId,
    errorCode: null,
  };
}

export async function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!isPositiveInteger(timeoutMs)) {
    throw new ProviderValidationError('timeoutMs must be a positive integer.');
  }

  const controller = new AbortController();
  const timeoutError = new ProviderTimeoutError();
  let rejectTimeout: ((reason?: unknown) => void) | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    rejectTimeout = reject;
  });
  const timeoutHandle = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  if (typeof timeoutHandle.unref === 'function') {
    timeoutHandle.unref();
  }
  const rejectHandle = setTimeout(() => {
    rejectTimeout?.(timeoutError);
  }, timeoutMs);
  if (typeof rejectHandle.unref === 'function') {
    rejectHandle.unref();
  }

  try {
    return await Promise.race<T>([
      operation(controller.signal),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
    clearTimeout(rejectHandle);
  }
}

export function normalizeProviderErrorCode(error: unknown): ProviderErrorCode {
  if (error instanceof ProviderValidationError) {
    return 'invalid_request';
  }

  if (error instanceof ProviderTimeoutError) {
    return 'timeout';
  }

  if (isAbortError(error)) {
    return 'timeout';
  }

  const status = readNumericProperty(error, 'status') ?? readNumericProperty(error, 'statusCode');
  if (status === 401 || status === 403) {
    return 'auth_error';
  }

  if (status === 429) {
    return 'rate_limited';
  }

  if (typeof status === 'number' && status >= 500) {
    return 'provider_error';
  }

  const code = readStringProperty(error, 'code')?.toLowerCase() ?? '';
  if (code.includes('timeout') || code.includes('aborted')) {
    return 'timeout';
  }
  if (code.includes('api_key') || code.includes('auth') || code.includes('unauthorized')) {
    return 'auth_error';
  }
  if (code.includes('rate') || code.includes('quota')) {
    return 'rate_limited';
  }

  return 'unknown_error';
}

export function normalizeProviderErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return scrubSecrets(error.message);
  }

  if (typeof error === 'string') {
    return scrubSecrets(error);
  }

  return 'Unknown provider failure.';
}

export function normalizeText(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'AbortError' || error.name === 'TimeoutError' || error.message.toLowerCase().includes('abort');
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = Reflect.get(value, key);
  return typeof candidate === 'string' ? candidate : null;
}

function readNumericProperty(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = Reflect.get(value, key);
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function scrubSecrets(message: string): string {
  return message
    .replaceAll(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replaceAll(/\b[A-Za-z0-9]{20,}\b/g, (match) => (looksLikeSecret(match) ? '[REDACTED]' : match));
}

function looksLikeSecret(value: string): boolean {
  return /[A-Za-z]/.test(value) && /[0-9]/.test(value) && value.length >= 24;
}
