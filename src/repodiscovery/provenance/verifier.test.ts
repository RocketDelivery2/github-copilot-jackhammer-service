import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RepoSeedFields } from '../../reposeed/types.js';
import {
  PORT_FAILURE_REASONS,
  ProvenanceError,
  ProvenancePortError,
  type PortFailureReason,
  type ProvenanceErrorCode,
} from './errors.js';
import {
  createFakePorts,
  expectedCalls,
  makeSeed,
  notFound,
  SHA1_FIELDS,
  SHA256_FIELDS,
  type FakeHandlers,
} from './fakes.js';
import { isCertificateForSeed, verifyRepoProvenance } from './verifier.js';

const SEED = makeSeed();
const OTHER_OID = 'f'.repeat(40);
const PARENT_REPOSITORY_ID = '1048576000';
const SUCCESS = expectedCalls(SHA1_FIELDS);

async function assertFails(
  promise: Promise<unknown>,
  code: ProvenanceErrorCode,
  details: Record<string, unknown>,
): Promise<ProvenanceError> {
  let caught: unknown;
  await promise.then(
    () => assert.fail(`expected ${code}`),
    (error: unknown) => {
      caught = error;
    },
  );
  assert.ok(caught instanceof ProvenanceError, 'expected a ProvenanceError');
  assert.equal(caught.code, code);
  assert.deepEqual({ ...caught.details }, details);
  assert.equal(caught.message.split(':')[0], code);
  assert.ok(Object.isFrozen(caught));
  assert.ok(Object.isFrozen(caught.details));
  return caught;
}

/** An explicit undefined seed is passed through, not replaced by the default. */
function verifyWith(handlers: FakeHandlers, ...rest: [seed?: unknown, fields?: RepoSeedFields]) {
  const seed = rest.length > 0 ? rest[0] : SEED;
  const { ports, calls } = createFakePorts(rest[1] ?? SHA1_FIELDS, handlers);
  return { result: verifyRepoProvenance(seed, ports), calls };
}

function portError(reason: PortFailureReason): () => never {
  return () => {
    throw new ProvenancePortError(reason, `fake ${reason}`);
  };
}

function environment(overrides: Record<string, unknown> = {}) {
  return { objectFormat: 'sha1', replaceRefs: 'absent', alternates: 'absent', ...overrides };
}

/** Clean on the first sample, the given record on the second. */
function postSample(record: unknown): (sample: number) => unknown {
  return (sample) => (sample === 0 ? environment() : record);
}

const poisoned = (): never => assert.fail('local port must not be called');
const POISONED_LOCAL: FakeHandlers = {
  getEnvironment: poisoned,
  getObjectType: poisoned,
  getCommitTree: poisoned,
};

describe('verifyRepoProvenance success', () => {
  it('certifies a sha1 revision with exactly 2 GitHub and 5 local calls in order', async () => {
    const { result, calls } = verifyWith({});
    const certificate = await result;
    assert.deepEqual(calls, SUCCESS);
    assert.equal(Object.getPrototypeOf(certificate), null);
    assert.deepEqual(Object.keys(certificate), [
      'kind', 'version', 'identity', 'githubCommitScope', 'authorizes', 'requiresReverification',
    ]);
    assert.equal(certificate.kind, 'jackhammer.repodiscovery.provenance');
    assert.equal(certificate.version, '1');
    assert.equal(certificate.githubCommitScope, 'repository-reachable');
    assert.equal(certificate.authorizes, false);
    assert.equal(certificate.requiresReverification, true);
    assert.equal(Object.getPrototypeOf(certificate.identity), null);
    assert.deepEqual({ ...certificate.identity }, { ...SEED });
    assert.deepEqual(Object.keys(certificate.identity), [
      'schemaVersion', 'host', 'repositoryId', 'objectFormat', 'commitSha', 'treeSha', 'seedSha256',
    ]);
  });

  it('certifies a sha256 revision', async () => {
    const seed = makeSeed(SHA256_FIELDS);
    const { result, calls } = verifyWith({
      getEnvironment: () => environment({ objectFormat: 'sha256' }),
    }, seed, SHA256_FIELDS);
    const certificate = await result;
    assert.equal(certificate.identity.objectFormat, 'sha256');
    assert.equal(certificate.identity.repositoryId, '9007199254740993');
    assert.deepEqual(calls, expectedCalls(SHA256_FIELDS));
  });

  it('returns a deeply frozen certificate with data properties only', async () => {
    const certificate = await verifyWith({}).result;
    for (const record of [certificate, certificate.identity]) {
      assert.ok(Object.isFrozen(record));
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(record))) {
        assert.ok('value' in descriptor);
      }
    }
  });

  it('is deterministic for the same seed and evidence', async () => {
    const first = await verifyWith({}).result;
    const second = await verifyWith({}).result;
    assert.notEqual(first, second);
    assert.deepEqual({ ...first, identity: { ...first.identity } }, { ...second, identity: { ...second.identity } });
  });

  it('copies identity from the seed, never from evidence', async () => {
    const seed = makeSeed();
    const certificate = await verifyWith({}, seed).result;
    (seed as { treeSha: string }).treeSha = OTHER_OID;
    assert.equal(certificate.identity.treeSha, SHA1_FIELDS.treeSha);
  });
});

describe('seed validation', () => {
  const accessorSeed = () => {
    let reads = 0;
    const seed: Record<string, unknown> = { ...SEED };
    Object.defineProperty(seed, 'treeSha', {
      enumerable: true,
      get: () => {
        reads++;
        return SHA1_FIELDS.treeSha;
      },
    });
    return { seed, reads: () => reads };
  };

  const shapeCases: Array<[string, () => unknown]> = [
    ['undefined', () => undefined],
    ['null', () => null],
    ['a string', () => 'seed'],
    ['an array', () => [SEED]],
    ['a missing key', () => {
      const { treeSha: _treeSha, ...rest } = SEED;
      return rest;
    }],
    ['an extra key', () => ({ ...SEED, extra: '1' })],
    ['a symbol key', () => ({ ...SEED, [Symbol('x')]: '1' })],
    ['an inherited key', () => Object.assign(Object.create({ treeSha: SEED.treeSha }), (() => {
      const { treeSha: _treeSha, ...rest } = SEED;
      return rest;
    })())],
    ['a class instance', () => Object.assign(new (class Seed {})(), SEED)],
    ['a createRepoSeed grammar rejection', () => ({ ...SEED, repositoryId: '0' })],
    ['an uppercase commit', () => ({ ...SEED, commitSha: SEED.commitSha.toUpperCase().replace(/1/g, 'A') })],
    ['a wrong host', () => ({ ...SEED, host: 'GitHub.com' })],
  ];

  for (const [name, build] of shapeCases) {
    it(`rejects ${name} as shape with zero port calls`, async () => {
      const { result, calls } = verifyWith({}, build());
      await assertFails(result, 'INVALID_SEED', { reason: 'shape' });
      assert.deepEqual(calls, []);
    });
  }

  it('rejects an accessor field as shape without invoking it', async () => {
    const { seed, reads } = accessorSeed();
    const { result, calls } = verifyWith({}, seed);
    await assertFails(result, 'INVALID_SEED', { reason: 'shape' });
    assert.equal(reads(), 0);
    assert.deepEqual(calls, []);
  });

  it('rejects a well-formed seed with a wrong digest as integrity', async () => {
    const { result, calls } = verifyWith({}, { ...SEED, seedSha256: 'a'.repeat(64) });
    await assertFails(result, 'INVALID_SEED', { reason: 'integrity' });
    assert.deepEqual(calls, []);
  });

  it('rejects a digest computed for different fields as integrity', async () => {
    const other = makeSeed({ treeSha: OTHER_OID });
    const { result } = verifyWith({}, { ...SEED, seedSha256: other.seedSha256 });
    await assertFails(result, 'INVALID_SEED', { reason: 'integrity' });
  });

  it('rejects a certificate passed as the seed before any port call', async () => {
    const certificate = await verifyWith({}).result;
    const { result, calls } = verifyWith({}, certificate);
    await assertFails(result, 'INVALID_SEED', { reason: 'shape' });
    assert.deepEqual(calls, []);
  });

  it('accepts a null-prototype seed and a consistent Proxy', async () => {
    const bare = Object.assign(Object.create(null), SEED);
    await verifyWith({}, bare).result;
    await verifyWith({}, new Proxy({ ...SEED }, {})).result;
  });

  it('rejects a Proxy whose traps throw as shape', async () => {
    const hostile = new Proxy({ ...SEED }, {
      ownKeys: () => {
        throw new Error('boom');
      },
    });
    await assertFails(verifyWith({}, hostile).result, 'INVALID_SEED', { reason: 'shape' });
  });

  it('is not fooled by a polluted Object.prototype', async () => {
    const { treeSha: _treeSha, ...rest } = SEED;
    Object.defineProperty(Object.prototype, 'treeSha', { value: SEED.treeSha, configurable: true });
    try {
      await assertFails(verifyWith({}, rest).result, 'INVALID_SEED', { reason: 'shape' });
    } finally {
      delete (Object.prototype as Record<string, unknown>).treeSha;
    }
  });
});

describe('port binding', () => {
  const { ports: healthy, calls: healthyCalls } = createFakePorts(SHA1_FIELDS);

  const containerCases: Array<[string, unknown]> = [
    ['undefined ports', undefined],
    ['null ports', null],
    ['a missing github side', { git: healthy.git }],
    ['a missing git side', { github: healthy.github }],
    ['a null github side', { github: null, git: healthy.git }],
    ['an inherited github side', Object.assign(Object.create({ github: healthy.github }), { git: healthy.git })],
  ];

  for (const [name, ports] of containerCases) {
    it(`rejects ${name} as container with zero calls`, async () => {
      await assertFails(verifyRepoProvenance(SEED, ports), 'INVALID_PORTS', { reason: 'container' });
      assert.deepEqual(healthyCalls, []);
    });
  }

  it('rejects an accessor side container without invoking it', async () => {
    let reads = 0;
    const ports = { git: healthy.git };
    Object.defineProperty(ports, 'github', {
      get: () => {
        reads++;
        return healthy.github;
      },
    });
    await assertFails(verifyRepoProvenance(SEED, ports), 'INVALID_PORTS', { reason: 'container' });
    assert.equal(reads, 0);
  });

  it('rejects missing, non-function and accessor methods without calls or getter reads', async () => {
    let reads = 0;
    const calls: string[] = [];
    const call = (name: string) => async () => {
      calls.push(name);
      return {};
    };
    const github = { getRepository: call('getRepository'), getCommit: call('getCommit') };
    const git = { getEnvironment: call('getEnvironment'), getObjectType: call('getObjectType') };
    await assertFails(verifyRepoProvenance(SEED, { github, git }), 'INVALID_PORTS', { reason: 'method' });
    await assertFails(
      verifyRepoProvenance(SEED, { github, git: { ...git, getCommitTree: 'nope' } }),
      'INVALID_PORTS',
      { reason: 'method' },
    );
    const accessorGit = { ...git };
    Object.defineProperty(accessorGit, 'getCommitTree', {
      get: () => {
        reads++;
        return call('getCommitTree');
      },
    });
    await assertFails(verifyRepoProvenance(SEED, { github, git: accessorGit }), 'INVALID_PORTS', { reason: 'method' });
    assert.equal(reads, 0);
    assert.deepEqual(calls, []);
  });

  it('rejects an accessor on an inherited port method without invoking it', async () => {
    let reads = 0;
    const { ports } = createFakePorts(SHA1_FIELDS);
    class AccessorGitPort {
      getEnvironment = ports.git.getEnvironment.bind(ports.git);
      getObjectType = ports.git.getObjectType.bind(ports.git);
      get getCommitTree() {
        reads++;
        return ports.git.getCommitTree.bind(ports.git);
      }
    }
    await assertFails(
      verifyRepoProvenance(SEED, { github: ports.github, git: new AccessorGitPort() }),
      'INVALID_PORTS',
      { reason: 'method' },
    );
    assert.equal(reads, 0);
  });

  it('accepts own methods on plain objects and inherited methods on class instances', async () => {
    const { ports } = createFakePorts(SHA1_FIELDS);
    assert.equal(Object.hasOwn(ports.github, 'getRepository'), false);
    await verifyRepoProvenance(SEED, ports);
    const plain = {
      github: {
        getRepository: ports.github.getRepository.bind(ports.github),
        getCommit: ports.github.getCommit.bind(ports.github),
      },
      git: {
        getEnvironment: ports.git.getEnvironment.bind(ports.git),
        getObjectType: ports.git.getObjectType.bind(ports.git),
        getCommitTree: ports.git.getCommitTree.bind(ports.git),
      },
    };
    await verifyRepoProvenance(SEED, plain);
  });

  it('does not take methods from a polluted Object.prototype', async () => {
    const { ports } = createFakePorts(SHA1_FIELDS);
    const github = { getCommit: ports.github.getCommit.bind(ports.github) };
    Object.defineProperty(Object.prototype, 'getRepository', {
      value: ports.github.getRepository.bind(ports.github),
      configurable: true,
    });
    try {
      await assertFails(verifyRepoProvenance(SEED, { github, git: ports.git }), 'INVALID_PORTS', { reason: 'method' });
    } finally {
      delete (Object.prototype as Record<string, unknown>).getRepository;
    }
  });
});

describe('GitHub evidence', () => {
  it('rejects a different repository ID echo from getRepository', async () => {
    const { result, calls } = verifyWith({
      ...POISONED_LOCAL,
      getRepository: () => ({ repositoryId: PARENT_REPOSITORY_ID, objectFormat: 'sha1' }),
    });
    await assertFails(result, 'SUBJECT_ECHO_MISMATCH', { side: 'github', method: 'getRepository' });
    assert.equal(calls.length, 1);
  });

  it('does not accept a host field from getRepository', async () => {
    const { result } = verifyWith({
      getRepository: (repositoryId) => ({ repositoryId, objectFormat: 'sha1', host: 'github.com' }),
    });
    await assertFails(result, 'INVALID_PORT_RESPONSE', { side: 'github', method: 'getRepository' });
  });

  for (const [name, record] of [
    ['missing', { repositoryId: SHA1_FIELDS.repositoryId }],
    ['invalid', { repositoryId: SHA1_FIELDS.repositoryId, objectFormat: 'SHA1' }],
    ['different', { repositoryId: SHA1_FIELDS.repositoryId, objectFormat: 'sha256' }],
  ] as const) {
    it(`rejects a ${name} GitHub object format after one call`, async () => {
      const { result, calls } = verifyWith({ ...POISONED_LOCAL, getRepository: () => record });
      await assertFails(result, 'OBJECT_FORMAT_MISMATCH', { source: 'github' });
      assert.equal(calls.length, 1);
    });
  }

  it('maps an adapter that cannot establish the format to an ambiguous GitHub failure', async () => {
    const { result } = verifyWith({ getRepository: portError('ambiguous') });
    await assertFails(result, 'GITHUB_PORT_FAILURE', {
      side: 'github', method: 'getRepository', reason: 'ambiguous',
    });
  });

  it('reports a wrong GitHub format before a poisoned local store, with zero local calls', async () => {
    const { result, calls } = verifyWith({
      ...POISONED_LOCAL,
      getRepository: (repositoryId) => ({ repositoryId, objectFormat: 'sha256' }),
    });
    await assertFails(result, 'OBJECT_FORMAT_MISMATCH', { source: 'github' });
    assert.deepEqual(calls, [SUCCESS[0]]);
  });

  it('rejects a fork parent repository ID from getCommit as a subject echo mismatch', async () => {
    const { result, calls } = verifyWith({
      ...POISONED_LOCAL,
      getCommit: (_repositoryId, commitOid) => ({
        repositoryId: PARENT_REPOSITORY_ID, commitOid, treeOid: SHA1_FIELDS.treeSha, scope: 'repository-reachable',
      }),
    });
    await assertFails(result, 'SUBJECT_ECHO_MISMATCH', { side: 'github', method: 'getCommit' });
    assert.equal(calls.length, 2);
  });

  it('rejects a commit echo that differs only in case', async () => {
    const { result } = verifyWith({
      getCommit: (repositoryId) => ({
        repositoryId, commitOid: 'A'.repeat(40), treeOid: SHA1_FIELDS.treeSha, scope: 'repository-reachable',
      }),
    }, makeSeed({ commitSha: 'a'.repeat(40) }));
    await assertFails(result, 'SUBJECT_ECHO_MISMATCH', { side: 'github', method: 'getCommit' });
  });

  for (const [name, scope] of [['missing', undefined], ['network-pool', 'network-pool'], ['upper-case', 'REPOSITORY-REACHABLE']] as const) {
    it(`rejects a ${name} commit scope after two calls`, async () => {
      const { result, calls } = verifyWith({
        ...POISONED_LOCAL,
        getCommit: (repositoryId, commitOid) => {
          const record: Record<string, unknown> = { repositoryId, commitOid, treeOid: SHA1_FIELDS.treeSha };
          if (scope !== undefined) {
            record.scope = scope;
          }
          return record;
        },
      });
      await assertFails(result, 'SCOPE_NOT_REPOSITORY_REACHABLE', { side: 'github', method: 'getCommit' });
      assert.equal(calls.length, 2);
    });
  }

  it('rejects a GitHub tree mismatch before any local call', async () => {
    const { result, calls } = verifyWith({
      ...POISONED_LOCAL,
      getCommit: (repositoryId, commitOid) => ({
        repositoryId, commitOid, treeOid: OTHER_OID, scope: 'repository-reachable',
      }),
    });
    await assertFails(result, 'TREE_MISMATCH', { source: 'github' });
    assert.equal(calls.length, 2);
  });

  it('checks repository echo, then commit echo, then scope, then tree', async () => {
    const all = { repositoryId: PARENT_REPOSITORY_ID, commitOid: OTHER_OID, treeOid: OTHER_OID, scope: 'x' };
    await assertFails(verifyWith({ getCommit: () => all }).result, 'SUBJECT_ECHO_MISMATCH', {
      side: 'github', method: 'getCommit',
    });
    const repositoryOk = { ...all, repositoryId: SHA1_FIELDS.repositoryId };
    await assertFails(verifyWith({ getCommit: () => repositoryOk }).result, 'SUBJECT_ECHO_MISMATCH', {
      side: 'github', method: 'getCommit',
    });
    const echoesOk = { ...repositoryOk, commitOid: SHA1_FIELDS.commitSha };
    await assertFails(verifyWith({ getCommit: () => echoesOk }).result, 'SCOPE_NOT_REPOSITORY_REACHABLE', {
      side: 'github', method: 'getCommit',
    });
  });

  for (const method of ['getRepository', 'getCommit'] as const) {
    for (const reason of PORT_FAILURE_REASONS) {
      it(`maps a typed ${reason} from ${method} with zero local calls`, async () => {
        const { result, calls } = verifyWith({ ...POISONED_LOCAL, [method]: portError(reason) });
        await assertFails(result, 'GITHUB_PORT_FAILURE', { side: 'github', method, reason });
        assert.equal(calls.length, method === 'getRepository' ? 1 : 2);
      });
    }
  }
});

describe('port failures and malformed responses', () => {
  const methods = [
    ['github', 'getRepository', 1],
    ['github', 'getCommit', 2],
    ['local', 'getEnvironment', 3],
    ['local', 'getObjectType', 4],
    ['local', 'getCommitTree', 5],
  ] as const;

  for (const [side, method, count] of methods) {
    it(`redacts an untyped throw from ${method}`, async () => {
      const lookalike = { name: 'ProvenancePortError', reason: 'not-found', message: 'secret-token-value' };
      const { result, calls } = verifyWith({
        [method]: () => {
          throw lookalike;
        },
      });
      const error = await assertFails(result, 'UNTYPED_PORT_FAILURE', { side, method });
      assert.equal(error.message.includes('secret-token-value'), false);
      assert.equal(calls.length, count);
    });

    for (const [name, record] of [
      ['null', null],
      ['an array', []],
      ['a class instance', new (class Evidence {})()],
      ['an extra key', { surprise: true }],
    ] as const) {
      it(`rejects ${name} from ${method} as a malformed response`, async () => {
        const { result, calls } = verifyWith({ [method]: () => record });
        await assertFails(result, 'INVALID_PORT_RESPONSE', { side, method });
        assert.equal(calls.length, count);
      });
    }

    it(`rejects an accessor in ${method} evidence without invoking it`, async () => {
      let reads = 0;
      const record = {};
      Object.defineProperty(record, 'oid', {
        enumerable: true,
        get: () => {
          reads++;
          return SHA1_FIELDS.commitSha;
        },
      });
      const { result, calls } = verifyWith({ [method]: () => record });
      await assertFails(result, 'INVALID_PORT_RESPONSE', { side, method });
      assert.equal(reads, 0);
      assert.equal(calls.length, count);
    });
  }

  for (const [method, count] of [['getEnvironment', 3], ['getObjectType', 4], ['getCommitTree', 5]] as const) {
    for (const reason of PORT_FAILURE_REASONS) {
      it(`maps a typed ${reason} from ${method}`, async () => {
        const { result, calls } = verifyWith({ [method]: portError(reason) });
        await assertFails(result, 'LOCAL_PORT_FAILURE', { side: 'local', method, reason });
        assert.equal(calls.length, count);
      });
    }
  }

  it('rejects an accessor on a semantic evidence field without invoking it', async () => {
    let reads = 0;
    const record = {
      repositoryId: SHA1_FIELDS.repositoryId,
      commitOid: SHA1_FIELDS.commitSha,
      scope: 'repository-reachable',
    };
    Object.defineProperty(record, 'treeOid', {
      enumerable: true,
      get: () => {
        reads++;
        return SHA1_FIELDS.treeSha;
      },
    });
    const { result, calls } = verifyWith({ ...POISONED_LOCAL, getCommit: () => record });
    await assertFails(result, 'INVALID_PORT_RESPONSE', { side: 'github', method: 'getCommit' });
    assert.equal(reads, 0);
    assert.equal(calls.length, 2);
  });

  it('keeps the port failure reason set closed at runtime', () => {
    assert.ok(Object.isFrozen(PORT_FAILURE_REASONS));
    assert.throws(() => (PORT_FAILURE_REASONS as unknown as string[]).push('token=LEAKED'), TypeError);
    assert.deepEqual([...PORT_FAILURE_REASONS], [
      'not-found', 'unauthorized', 'rate-limited', 'unavailable', 'ambiguous', 'io-error',
    ]);
    assert.throws(() => new ProvenancePortError('token=LEAKED' as PortFailureReason, 'x'), TypeError);
  });

  it('rejects a non-string repository ID echo as malformed, not as a mismatch', async () => {
    const { result } = verifyWith({ getRepository: () => ({ repositoryId: 1048576001, objectFormat: 'sha1' }) });
    await assertFails(result, 'INVALID_PORT_RESPONSE', { side: 'github', method: 'getRepository' });
  });

  it('rejects an unknown object type as malformed', async () => {
    const { result } = verifyWith({ getObjectType: (oid) => ({ oid, type: 'symlink' }) });
    await assertFails(result, 'INVALID_PORT_RESPONSE', { side: 'local', method: 'getObjectType' });
  });

  it('rejects an environment state outside the tri-state as malformed', async () => {
    for (const state of [undefined, 'ABSENT', [], false]) {
      const { result } = verifyWith({ getEnvironment: () => environment({ replaceRefs: state }) });
      await assertFails(result, 'INVALID_PORT_RESPONSE', { side: 'local', method: 'getEnvironment' });
    }
  });

  it('does not let a ProvenanceError thrown by a port pass through', async () => {
    const { result } = verifyWith({
      getRepository: () => {
        throw new ProvenanceError('OBJECT_FORMAT_MISMATCH', { source: 'local' });
      },
    });
    await assertFails(result, 'UNTYPED_PORT_FAILURE', { side: 'github', method: 'getRepository' });
  });
});

describe('local evidence', () => {
  for (const [name, format] of [['missing', undefined], ['invalid', 'md5'], ['different', 'sha256']] as const) {
    it(`rejects a ${name} local object format before object reads`, async () => {
      const { result, calls } = verifyWith({
        getEnvironment: () => {
          const record: Record<string, unknown> = environment();
          if (format === undefined) {
            delete record.objectFormat;
          } else {
            record.objectFormat = format;
          }
          return record;
        },
        getObjectType: poisoned,
      });
      await assertFails(result, 'OBJECT_FORMAT_MISMATCH', { source: 'local' });
      assert.equal(calls.length, 3);
    });
  }

  it('rejects a commit object of the wrong type without reading its tree', async () => {
    for (const type of ['tag', 'blob', 'tree']) {
      const { result, calls } = verifyWith({ getObjectType: (oid) => ({ oid, type }), getCommitTree: poisoned });
      await assertFails(result, 'OBJECT_TYPE_MISMATCH', { object: 'commit' });
      assert.equal(calls.length, 4);
    }
  });

  it('rejects a local object echo mismatch', async () => {
    const { result } = verifyWith({ getObjectType: () => ({ oid: OTHER_OID, type: 'commit' }) });
    await assertFails(result, 'SUBJECT_ECHO_MISMATCH', { side: 'local', method: 'getObjectType' });
  });

  it('rejects local echoes that differ only in case', async () => {
    const fields = { ...SHA1_FIELDS, commitSha: 'a'.repeat(40) };
    const seed = makeSeed(fields);
    await assertFails(
      verifyWith({ getObjectType: (oid) => ({ oid: oid.toUpperCase(), type: 'commit' }) }, seed, fields).result,
      'SUBJECT_ECHO_MISMATCH',
      { side: 'local', method: 'getObjectType' },
    );
    await assertFails(
      verifyWith({
        getCommitTree: (commitOid) => ({ commitOid: commitOid.toUpperCase(), treeOid: fields.treeSha }),
      }, seed, fields).result,
      'SUBJECT_ECHO_MISMATCH',
      { side: 'local', method: 'getCommitTree' },
    );
  });

  it('rejects a local commit-tree echo mismatch', async () => {
    const { result } = verifyWith({ getCommitTree: () => ({ commitOid: OTHER_OID, treeOid: SHA1_FIELDS.treeSha }) });
    await assertFails(result, 'SUBJECT_ECHO_MISMATCH', { side: 'local', method: 'getCommitTree' });
  });

  it('rejects a local tree mismatch before the tree-type check', async () => {
    const { result, calls } = verifyWith({
      getCommitTree: (commitOid) => ({ commitOid, treeOid: OTHER_OID }),
    });
    await assertFails(result, 'TREE_MISMATCH', { source: 'local' });
    assert.equal(calls.length, 5);
  });

  it('rejects a tree object of the wrong type after six calls', async () => {
    for (const type of ['blob', 'commit']) {
      const { result, calls } = verifyWith({
        getObjectType: (oid) => ({ oid, type: oid === SHA1_FIELDS.commitSha ? 'commit' : type }),
      });
      await assertFails(result, 'OBJECT_TYPE_MISMATCH', { object: 'tree' });
      assert.deepEqual(calls, SUCCESS.slice(0, 6));
    }
  });

  it('reports a tree missing at the tree-type step as a local not-found after six calls', async () => {
    const { result, calls } = verifyWith({
      getObjectType: (oid) => (oid === SHA1_FIELDS.commitSha ? { oid, type: 'commit' } : notFound()),
    });
    await assertFails(result, 'LOCAL_PORT_FAILURE', { side: 'local', method: 'getObjectType', reason: 'not-found' });
    assert.deepEqual(calls, SUCCESS.slice(0, 6));
  });
});

describe('environment tri-state', () => {
  for (const check of ['replaceRefs', 'alternates'] as const) {
    for (const state of ['present', 'unknown'] as const) {
      it(`rejects ${check} ${state} on the first sample with no object reads`, async () => {
        const { result, calls } = verifyWith({
          getEnvironment: () => environment({ [check]: state }),
          getObjectType: poisoned,
        });
        await assertFails(result, 'ENVIRONMENT_UNSAFE', { check, state });
        assert.deepEqual(calls, SUCCESS.slice(0, 3));
      });

      it(`reports ${check} ${state} on the second sample as changed`, async () => {
        const { result, calls } = verifyWith({ getEnvironment: postSample(environment({ [check]: state })) });
        await assertFails(result, 'ENVIRONMENT_CHANGED', { check, state });
        assert.deepEqual(calls, SUCCESS);
      });
    }
  }

  it('checks replaceRefs before alternates on both samples', async () => {
    const both = environment({ replaceRefs: 'unknown', alternates: 'present' });
    await assertFails(verifyWith({ getEnvironment: () => both }).result, 'ENVIRONMENT_UNSAFE', {
      check: 'replaceRefs', state: 'unknown',
    });
    await assertFails(verifyWith({ getEnvironment: postSample(both) }).result, 'ENVIRONMENT_CHANGED', {
      check: 'replaceRefs', state: 'unknown',
    });
  });

  it('reports a local format mismatch before an unsafe state on the first sample', async () => {
    const { result } = verifyWith({
      getEnvironment: () => environment({ objectFormat: 'sha256', replaceRefs: 'present' }),
    });
    await assertFails(result, 'OBJECT_FORMAT_MISMATCH', { source: 'local' });
  });

  it('reports a format change on the second sample as changed, ahead of unsafe states', async () => {
    for (const record of [
      environment({ objectFormat: 'sha256' }),
      environment({ objectFormat: 'sha256', alternates: 'present' }),
      { replaceRefs: 'absent', alternates: 'absent' },
    ]) {
      const { result } = verifyWith({ getEnvironment: postSample(record) });
      await assertFails(result, 'ENVIRONMENT_CHANGED', { check: 'objectFormat' });
    }
  });

  it('maps second-sample port failures to their own codes', async () => {
    await assertFails(
      verifyWith({ getEnvironment: (sample) => (sample === 0 ? environment() : portError('io-error')()) }).result,
      'LOCAL_PORT_FAILURE',
      { side: 'local', method: 'getEnvironment', reason: 'io-error' },
    );
    await assertFails(
      verifyWith({
        getEnvironment: (sample) => {
          if (sample === 0) {
            return environment();
          }
          throw new Error('raw');
        },
      }).result,
      'UNTYPED_PORT_FAILURE',
      { side: 'local', method: 'getEnvironment' },
    );
    await assertFails(
      verifyWith({ getEnvironment: postSample(environment({ extra: 1 })) }).result,
      'INVALID_PORT_RESPONSE',
      { side: 'local', method: 'getEnvironment' },
    );
  });
});

describe('isCertificateForSeed', () => {
  it('is true for a minted certificate and its own seed', async () => {
    const certificate = await verifyWith({}).result;
    assert.equal(isCertificateForSeed(certificate, SEED), true);
    assert.equal(isCertificateForSeed(certificate, { ...SEED }), true);
  });

  it('is false for a structural copy, another seed or an invalid seed', async () => {
    const certificate = await verifyWith({}).result;
    const copy = Object.freeze({ ...certificate, identity: Object.freeze({ ...certificate.identity }) });
    assert.equal(isCertificateForSeed(copy, SEED), false);
    assert.equal(isCertificateForSeed(JSON.parse(JSON.stringify(certificate)), SEED), false);
    assert.equal(isCertificateForSeed(certificate, makeSeed({ treeSha: OTHER_OID })), false);
    assert.equal(isCertificateForSeed(certificate, { ...SEED, seedSha256: 'a'.repeat(64) }), false);
    assert.equal(isCertificateForSeed(certificate, null), false);
    assert.equal(isCertificateForSeed(null, SEED), false);
    assert.equal(isCertificateForSeed('certificate', SEED), false);
  });

  it('never throws on hostile input and makes no port calls', async () => {
    const { result, calls } = verifyWith({});
    const certificate = await result;
    const hostile = new Proxy({}, {
      getPrototypeOf: () => {
        throw new Error('boom');
      },
    });
    assert.equal(isCertificateForSeed(certificate, hostile), false);
    assert.equal(isCertificateForSeed(hostile, SEED), false);
    assert.equal(calls.length, SUCCESS.length);
  });

  it('still matches the same object when presented again: it is not replay protection', async () => {
    const certificate = await verifyWith({}).result;
    assert.equal(isCertificateForSeed(certificate, SEED), true);
    assert.equal(isCertificateForSeed(certificate, SEED), true);
    assert.equal(certificate.requiresReverification, true);
    assert.equal(certificate.authorizes, false);
  });
});
