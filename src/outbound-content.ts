export class OutboundContentError extends Error {
  constructor(reason: string) {
    super(`Outbound content rejected: ${reason}`);
    this.name = 'OutboundContentError';
  }
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i,
];

export function assertSafeOutboundText(text: string, label = 'text'): void {
  if (typeof text !== 'string' || text.length === 0) {
    throw new OutboundContentError(`${label} is missing or unreadable`);
  }
  if (text.includes('\u0000')) {
    throw new OutboundContentError(`${label} contains unsupported binary data`);
  }
  if (SECRET_PATTERNS.some(pattern => pattern.test(text))) {
    throw new OutboundContentError(`${label} contains a rejected credential format`);
  }
}
