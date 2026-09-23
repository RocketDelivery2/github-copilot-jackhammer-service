import { createHash, timingSafeEqual } from 'node:crypto';
import type { RepoSeed, RepoSeedFields, RepoSeedObjectFormat } from './types.js';

const DOMAIN = new TextEncoder().encode('jackhammer:reposeed:v1\0');
const FIELD_KEYS = [
  'schemaVersion',
  'host',
  'repositoryId',
  'objectFormat',
  'commitSha',
  'treeSha',
] as const;
const SEED_KEYS = [...FIELD_KEYS, 'seedSha256'] as const;
const LOWERCASE_HEX = /^[0-9a-f]+$/;
const REPOSITORY_ID = /^[1-9][0-9]*$/;

export function createRepoSeed(input: unknown): RepoSeed {
  const value = requireRecord(input, 'RepoSeed');
  requireExactKeys(value, SEED_KEYS, 'RepoSeed');
  const fields = validateFields(value);
  const seedSha256 = requireHex(value.seedSha256, 64, 'seedSha256');
  return deepFreeze({ ...fields, seedSha256 });
}

export function frameRepoSeedField(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 0xffffffff) {
    throw new Error('RepoSeed field exceeds uint32 byte length');
  }
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, bytes.length, false);
  return concat(length, bytes);
}

export function buildRepoSeedPreimage(seed: RepoSeedFields): Uint8Array {
  return concat(
    DOMAIN,
    ...FIELD_KEYS.map((key) => frameRepoSeedField(seed[key])),
  );
}

export function computeRepoSeedSha256(seed: RepoSeedFields): string {
  return createHash('sha256').update(buildRepoSeedPreimage(seed)).digest('hex');
}

export function verifyRepoSeedIntegrity(input: unknown): boolean {
  try {
    const seed = createRepoSeed(input);
    const expected = computeRepoSeedSha256(seed);
    return timingSafeEqual(
      Buffer.from(seed.seedSha256, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

function validateFields(value: Record<string, unknown>): RepoSeedFields {
  if (value.schemaVersion !== '1') {
    throw new Error('schemaVersion must be exactly "1"');
  }
  if (value.host !== 'github.com') {
    throw new Error('host must be exactly "github.com"');
  }
  const repositoryId = requireAsciiString(value.repositoryId, 'repositoryId');
  if (!REPOSITORY_ID.test(repositoryId)) {
    throw new Error('repositoryId must be a positive non-zero decimal string');
  }

  const objectFormat = value.objectFormat;
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
    throw new Error('objectFormat must be "sha1" or "sha256"');
  }
  const oidLength = objectFormat === 'sha1' ? 40 : 64;
  const commitSha = requireHex(value.commitSha, oidLength, 'commitSha');
  const treeSha = requireHex(value.treeSha, oidLength, 'treeSha');

  return { schemaVersion: '1', host: 'github.com', repositoryId, objectFormat, commitSha, treeSha };
}

function requireRecord(input: unknown, name: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`${name} must be an object`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${name} must be a plain object`);
  }
  return input as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  const actual = Reflect.ownKeys(value);
  const hasUnexpectedKey = actual.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  );
  const hasMissingKey = keys.some(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (actual.length !== keys.length || hasUnexpectedKey || hasMissingKey) {
    throw new Error(`${name} contains missing or extra properties`);
  }
}

function requireAsciiString(input: unknown, name: string): string {
  if (typeof input !== 'string' || !/^[\x00-\x7f]*$/.test(input) || input.length === 0) {
    throw new Error(`${name} must be a non-empty ASCII string`);
  }
  return input;
}

function requireHex(input: unknown, length: number, name: string): string {
  if (typeof input !== 'string' || input.length !== length || !LOWERCASE_HEX.test(input)) {
    throw new Error(`${name} must be ${length} lowercase hexadecimal characters`);
  }
  return input;
}

function deepFreeze<T extends object>(value: T): T {
  Object.freeze(value);
  return value;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export type { RepoSeedObjectFormat };
