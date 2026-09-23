import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  buildRepoSeedPreimage,
  computeRepoSeedSha256,
  createRepoSeed,
  frameRepoSeedField,
  verifyRepoSeedIntegrity,
} from './repo-seed.js';
import type { RepoSeed } from './types.js';

const fields = {
  schemaVersion: '1',
  host: 'github.com',
  repositoryId: '123456789',
  objectFormat: 'sha1',
  commitSha: 'a961afb4f3ee11d1eadaf30eeb78d0db6cda58fb',
  treeSha: '20254353e29f00e0839b7c3f883e646bb435d4e5',
} as const;

const vector: RepoSeed = {
  ...fields,
  seedSha256: '23b24facf3fc754a043902c717a28d9d7377b457dfd2448959df57b98a86bb92',
};

describe('RepoSeed core', () => {
  it('matches the canonical preimage length, bytes, and digest', () => {
    const preimage = buildRepoSeedPreimage(fields);
    assert.equal(preimage.length, 151);
    assert.equal(Buffer.from(preimage).toString('hex'),
      '6a61636b68616d6d65723a7265706f736565643a76310000000001310000000a6769746875622e636f6d00000009313233343536373839000000047368613100000028613936316166623466336565313164316561646166333065656237386430646236636461353866620000002832303235343335336532396630306530383339623763336638383365363436626234333564346535');
    assert.equal(computeRepoSeedSha256(fields), vector.seedSha256);
    assert.equal(verifyRepoSeedIntegrity(vector), true);
  });

  it('rejects invalid canonical values', () => {
    const invalid = [
      { commitSha: fields.commitSha.toUpperCase() },
      { treeSha: fields.treeSha.toUpperCase() },
      { repositoryId: '0123' },
      { repositoryId: '0' },
      { repositoryId: ' 123' },
      { repositoryId: '+123' },
      { commitSha: fields.commitSha.slice(1) },
      { objectFormat: 'sha512' },
      { host: 'github.com ' },
    ];
    for (const change of invalid) {
      assert.throws(() => createRepoSeed({ ...vector, ...change }));
    }
  });

  it('deeply freezes the validated artifact and detects corruption', () => {
    const seed = createRepoSeed(vector);
    assert.equal(Object.isFrozen(seed), true);
    assert.equal(verifyRepoSeedIntegrity({ ...vector, seedSha256: '0'.repeat(64) }), false);
  });

  it('uses big-endian byte lengths, not little-endian lengths', () => {
    const canonical = buildRepoSeedPreimage(fields);
    const littleEndian = concatLittleEndian([
      '1', 'github.com', '123456789', 'sha1', fields.commitSha, fields.treeSha,
    ]);
    assert.notDeepEqual(littleEndian, canonical);
    assert.notEqual(computeRepoSeedSha256(fields), computeLittleEndianDigest(littleEndian));
  });

  it('frames UTF-8 byte lengths and zero-length helper values', () => {
    assert.deepEqual([...frameRepoSeedField('é')], [0, 0, 0, 2, 0xc3, 0xa9]);
    assert.deepEqual([...frameRepoSeedField('')], [0, 0, 0, 0]);
  });
});

function concatLittleEndian(values: string[]): Uint8Array {
  const domain = new TextEncoder().encode('jackhammer:reposeed:v1\0');
  const parts = values.map((value) => {
    const bytes = new TextEncoder().encode(value);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, bytes.length, true);
    return concat(length, bytes);
  });
  return concat(domain, ...parts);
}

function computeLittleEndianDigest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
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
