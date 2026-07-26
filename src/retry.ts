export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (error: unknown) => boolean;
};

const TRANSIENT_ERROR_PATTERNS = [
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /EPIPE/i,
  /socket hang up/i,
  /fetch failed/i,
  /temporary failure/i,
  /rate limit/i,
  /503/i,
  /502/i,
  /504/i,
];

export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 250));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(options.maxDelayMs ?? 2_000));
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? isTransientError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      if (options.label) {
        console.warn(`${options.label} transient failure; retrying in ${delayMs}ms (attempt ${attempt + 1}/${attempts}).`);
      }
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export function isTransientError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as {
    status?: number;
    code?: string;
    message?: string;
    response?: { status?: number };
  };

  const status = candidate.status ?? candidate.response?.status;
  if (status !== undefined && [429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const code = candidate.code ?? '';
  if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'].includes(code)) {
    return true;
  }

  const message = candidate.message ?? '';
  return TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}
