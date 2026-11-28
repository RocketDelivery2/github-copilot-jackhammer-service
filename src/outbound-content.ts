import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export class OutboundContentError extends Error {
  constructor(reason: string) {
    super(`Outbound content rejected: ${reason}`);
    this.name = 'OutboundContentError';
  }
}

export const MAX_REPOSITORY_TEXT_FILE_BYTES = 80_000;
export const MAX_GITIGNORE_BYTES = 64_000;
export const MAX_REPOSITORY_TEXT_FILES = 80;
export const MAX_REPOSITORY_CONTEXT_BYTES = 450_000;
export const MAX_REPOSITORY_ENTRIES = 10_000;
export const MAX_REPOSITORY_PATH_BYTES = 4_096;
export const MAX_REPOSITORY_PATH_DEPTH = 64;
export const MAX_FINAL_TASK_PROMPT_BYTES = 600_000;
export const MAX_FINAL_CONTINUATION_PROMPT_BYTES = 64_000;
export const MAX_GUIDANCE_FIELD_BYTES = 8_000;
export const MAX_RECENT_CHANGES_BYTES = 4_000;
export const MAX_PACKAGE_HINT_BYTES = 8_000;

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/i,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /(?:api[_-]?key|client[_-]?secret|password|access[_-]?token|secret[_-]?access[_-]?key|shared[_-]?access[_-]?key|account[_-]?key|signing[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i,
];
const EXCLUDED_COMPONENTS = new Set([
  '.git', '.hg', '.svn', '.env', '.npmrc', 'credentials.json', 'secrets.txt',
  '.envrc',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.aws', '.ssh',
]);
const EXCLUDED_EXTENSIONS = new Set([
  '.pem', '.key', '.p12', '.pfx', '.p7b', '.p7c', '.p8', '.ppk', '.keystore',
]);

export function isExcludedOutboundPath(relativePath: string): boolean {
  return relativePath.split('/').some((component) => {
    const lower = component.toLowerCase();
    return EXCLUDED_COMPONENTS.has(lower)
      || lower.startsWith('.env.')
      || lower === '.gitignore'
      || EXCLUDED_EXTENSIONS.has(path.posix.extname(lower));
  });
}

export type BoundedReadStage = 'after-path-check' | 'after-open' | 'after-read';

export type BoundedReadTestHook = (
  stage: BoundedReadStage,
  filePath: string,
) => void | Promise<void>;

function assertContained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new OutboundContentError('repository path escapes the containment root');
  }
}

function sameIdentity(
  left: BigIntStats,
  right: BigIntStats,
): boolean {
  return left.isFile()
    && right.isFile()
    && !left.isSymbolicLink()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

export async function readBoundedRepositoryFile(
  rootPath: string,
  filePath: string,
  maximumBytes: number,
  testHook?: BoundedReadTestHook,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0
    || maximumBytes > MAX_REPOSITORY_TEXT_FILE_BYTES) {
    throw new OutboundContentError('invalid bounded-read limit');
  }
  const canonicalRoot = await fs.realpath(rootPath);
  const canonicalPath = await fs.realpath(filePath);
  assertContained(canonicalRoot, canonicalPath);
  const beforePath = await fs.lstat(filePath, { bigint: true });
  if (!beforePath.isFile() || beforePath.isSymbolicLink()) {
    throw new OutboundContentError('unsupported or reparse repository path type');
  }
  if (beforePath.size > BigInt(maximumBytes)) {
    throw new OutboundContentError('repository input exceeds its byte limit');
  }
  await testHook?.('after-path-check', filePath);

  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
  const handle = await fs.open(filePath, constants.O_RDONLY | noFollow);
  try {
    await testHook?.('after-open', filePath);
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(beforePath, opened) || opened.size > BigInt(maximumBytes)) {
      throw new OutboundContentError('repository input identity changed before reading');
    }

    const content = Buffer.alloc(maximumBytes + 1);
    let offset = 0;
    while (offset < content.length) {
      const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumBytes) {
      throw new OutboundContentError('repository input grew beyond its byte limit');
    }
    await testHook?.('after-read', filePath);

    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await fs.lstat(filePath, { bigint: true });
    const canonicalAfterPath = await fs.realpath(filePath);
    assertContained(canonicalRoot, canonicalAfterPath);
    if (!sameIdentity(opened, afterHandle) || !sameIdentity(opened, afterPath)
      || canonicalPath !== canonicalAfterPath) {
      throw new OutboundContentError('repository input identity changed while reading');
    }
    return content.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export function decodeRepositoryText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new OutboundContentError('unsupported repository text encoding');
  }
}

export function assertWithinUtf8Limit(value: string, maximumBytes: number, label: string): void {
  if (Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new OutboundContentError(`${label} exceeds its byte limit`);
  }
}

export function derivePackageHints(
  files: readonly { path: string; content: string }[],
): string[] {
  return files
    .filter(file => ['package.json', 'pyproject.toml', 'requirements.txt', 'README.md'].includes(file.path))
    .slice(0, 4)
    .map(file => {
      const prefix = `${file.path}:\n`;
      const marker = '\n[truncated]';
      const contentLimit = MAX_PACKAGE_HINT_BYTES - Buffer.byteLength(prefix + marker, 'utf8');
      let content = '';
      let contentBytes = 0;
      for (const character of file.content) {
        const characterBytes = Buffer.byteLength(character, 'utf8');
        if (contentBytes + characterBytes > contentLimit) break;
        content += character;
        contentBytes += characterBytes;
      }
      return `${prefix}${content}${content.length < file.content.length ? marker : ''}`;
    });
}

export function summarizeRepositoryPath(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

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
