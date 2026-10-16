import { createRepoSeed, verifyRepoSeedIntegrity } from '../../reposeed/repo-seed.js';
import type { RepoSeed } from '../../reposeed/types.js';
import { ProvenanceError, portFailureReason, type PortCall } from './errors.js';
import type {
  ProvenanceCertificate,
  ProvenanceIdentity,
  ProvenanceObjectId,
  ProvenanceRepositoryId,
} from './types.js';

type Method = (...args: unknown[]) => unknown;
type Snapshot = Record<string, unknown>;
type Check = (value: unknown) => boolean;

interface BoundPorts {
  readonly getRepository: Method;
  readonly getCommit: Method;
  readonly getEnvironment: Method;
  readonly getObjectType: Method;
  readonly getCommitTree: Method;
}

const GITHUB_METHODS = ['getRepository', 'getCommit'] as const;
const LOCAL_METHODS = ['getEnvironment', 'getObjectType', 'getCommitTree'] as const;

const GET_REPOSITORY: PortCall = Object.freeze({ side: 'github', method: 'getRepository' });
const GET_COMMIT: PortCall = Object.freeze({ side: 'github', method: 'getCommit' });
const GET_ENVIRONMENT: PortCall = Object.freeze({ side: 'local', method: 'getEnvironment' });
const GET_OBJECT_TYPE: PortCall = Object.freeze({ side: 'local', method: 'getObjectType' });
const GET_COMMIT_TREE: PortCall = Object.freeze({ side: 'local', method: 'getCommitTree' });

const isString: Check = (value) => typeof value === 'string';
const isObjectType: Check = (value) => ['commit', 'tree', 'blob', 'tag'].includes(value as string);
const isEnvironmentState: Check = (value) => ['absent', 'present', 'unknown'].includes(value as string);

const minted = new WeakSet<object>();

/**
 * Proves that a RepoSeed names one exact GitHub repository revision, using only the injected
 * ports. Resolves to a frozen certificate or rejects with ProvenanceError. Port calls run
 * strictly in sequence (2 GitHub, then 5 local) and the first failure wins. There is no
 * fallback between GitHub and local evidence, and no retry or timeout: a port promise that
 * never settles leaves verification pending.
 */
export async function verifyRepoProvenance(
  seed: unknown,
  ports: unknown,
): Promise<ProvenanceCertificate> {
  const claim = validateSeed(seed);
  const port = bindPorts(ports);

  const repository = await callPort(GET_REPOSITORY,
    () => port.getRepository(Object.freeze({ repositoryId: claim.repositoryId })));
  requireShape(repository, GET_REPOSITORY, { repositoryId: isString }, ['objectFormat']);
  requireEcho(repository.repositoryId, claim.repositoryId, GET_REPOSITORY);
  if (repository.objectFormat !== claim.objectFormat) {
    throw new ProvenanceError('OBJECT_FORMAT_MISMATCH', { source: 'github' });
  }

  const commit = await callPort(GET_COMMIT,
    () => port.getCommit(Object.freeze({ repositoryId: claim.repositoryId, commitOid: claim.commitSha })));
  requireShape(commit, GET_COMMIT, { repositoryId: isString, commitOid: isString, treeOid: isString }, ['scope']);
  requireEcho(commit.repositoryId, claim.repositoryId, GET_COMMIT);
  requireEcho(commit.commitOid, claim.commitSha, GET_COMMIT);
  if (commit.scope !== 'repository-reachable') {
    throw new ProvenanceError('SCOPE_NOT_REPOSITORY_REACHABLE', { side: 'github', method: 'getCommit' });
  }
  if (commit.treeOid !== claim.treeSha) {
    throw new ProvenanceError('TREE_MISMATCH', { source: 'github' });
  }

  const before = await sampleEnvironment(port);
  if (before.objectFormat !== claim.objectFormat) {
    throw new ProvenanceError('OBJECT_FORMAT_MISMATCH', { source: 'local' });
  }
  for (const check of ['replaceRefs', 'alternates'] as const) {
    const state = before[check];
    if (state === 'present' || state === 'unknown') {
      throw new ProvenanceError('ENVIRONMENT_UNSAFE', { check, state });
    }
  }

  await requireObjectType(port, claim.commitSha, 'commit');

  const localCommit = await callPort(GET_COMMIT_TREE, () => port.getCommitTree(claim.commitSha));
  requireShape(localCommit, GET_COMMIT_TREE, { commitOid: isString, treeOid: isString });
  requireEcho(localCommit.commitOid, claim.commitSha, GET_COMMIT_TREE);
  if (localCommit.treeOid !== claim.treeSha) {
    throw new ProvenanceError('TREE_MISMATCH', { source: 'local' });
  }

  await requireObjectType(port, claim.treeSha, 'tree');

  // Every difference from the first sample is a within-run change, so it outranks the unsafe
  // and format codes. The first sample matched the seed and had both checks absent.
  const after = await sampleEnvironment(port);
  if (after.objectFormat !== claim.objectFormat) {
    throw new ProvenanceError('ENVIRONMENT_CHANGED', { check: 'objectFormat' });
  }
  for (const check of ['replaceRefs', 'alternates'] as const) {
    const state = after[check];
    if (state === 'present' || state === 'unknown') {
      throw new ProvenanceError('ENVIRONMENT_CHANGED', { check, state });
    }
  }

  return mintCertificate(claim);
}

/**
 * True only for a certificate object this module minted, in this process, whose identity
 * equals a valid, intact seed. Structural copies and deserialized certificates are rejected.
 * This is not a signature: it does not detect replay of the same object, and a holder must
 * still re-run verification before acting. Never throws and makes no port calls.
 */
export function isCertificateForSeed(certificate: unknown, seed: unknown): boolean {
  try {
    if (typeof certificate !== 'object' || certificate === null || !minted.has(certificate)) {
      return false;
    }
    const claim = tryValidateSeed(seed);
    if (claim === undefined) {
      return false;
    }
    const { identity } = certificate as ProvenanceCertificate;
    return identity.schemaVersion === claim.schemaVersion
      && identity.host === claim.host
      && identity.repositoryId === claim.repositoryId
      && identity.objectFormat === claim.objectFormat
      && identity.commitSha === claim.commitSha
      && identity.treeSha === claim.treeSha
      && identity.seedSha256 === claim.seedSha256;
  } catch {
    return false;
  }
}

/** Built from the validated seed and fixed literals only, never from evidence. */
function mintCertificate(claim: RepoSeed): ProvenanceCertificate {
  const identity: ProvenanceIdentity = Object.freeze(Object.assign(Object.create(null), {
    schemaVersion: claim.schemaVersion,
    host: claim.host,
    repositoryId: claim.repositoryId as ProvenanceRepositoryId,
    objectFormat: claim.objectFormat,
    commitSha: claim.commitSha as ProvenanceObjectId,
    treeSha: claim.treeSha as ProvenanceObjectId,
    seedSha256: claim.seedSha256,
  }));
  const certificate: ProvenanceCertificate = Object.freeze(Object.assign(Object.create(null), {
    kind: 'jackhammer.repodiscovery.provenance',
    version: '1',
    identity,
    githubCommitScope: 'repository-reachable',
    authorizes: false,
    requiresReverification: true,
  }));
  minted.add(certificate);
  return certificate;
}

function validateSeed(input: unknown): RepoSeed {
  const snapshot = snapshotRecord(input);
  if (snapshot === undefined) {
    throw new ProvenanceError('INVALID_SEED', { reason: 'shape' });
  }
  let seed: RepoSeed;
  try {
    seed = createRepoSeed(snapshot);
  } catch {
    throw new ProvenanceError('INVALID_SEED', { reason: 'shape' });
  }
  if (!verifyRepoSeedIntegrity(seed)) {
    throw new ProvenanceError('INVALID_SEED', { reason: 'integrity' });
  }
  return seed;
}

function tryValidateSeed(input: unknown): RepoSeed | undefined {
  try {
    return validateSeed(input);
  } catch {
    return undefined;
  }
}

/**
 * Reads each own key and descriptor once into a null-prototype copy. Rejects non-plain
 * prototypes, symbol keys and accessor properties without invoking them. A Proxy is read
 * through its traps once, so the copy is all the verifier ever sees.
 */
function snapshotRecord(input: unknown): Snapshot | undefined {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const copy: Snapshot = Object.create(null);
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string') {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        return undefined;
      }
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return undefined;
  }
}

function bindPorts(ports: unknown): BoundPorts {
  let github: object;
  let git: object;
  try {
    github = ownDataObject(ports, 'github');
    git = ownDataObject(ports, 'git');
  } catch {
    throw new ProvenanceError('INVALID_PORTS', { reason: 'container' });
  }
  const bound: Record<string, Method> = Object.create(null);
  try {
    for (const name of GITHUB_METHODS) {
      bound[name] = resolveMethod(github, name);
    }
    for (const name of LOCAL_METHODS) {
      bound[name] = resolveMethod(git, name);
    }
  } catch {
    throw new ProvenanceError('INVALID_PORTS', { reason: 'method' });
  }
  return Object.freeze(bound) as unknown as BoundPorts;
}

function ownDataObject(container: unknown, key: string): object {
  if (typeof container !== 'object' || container === null) {
    throw new TypeError('not an object');
  }
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  const value: unknown = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('not an object');
  }
  return value;
}

/**
 * Finds an own or inherited data method, stopping before Object.prototype so a polluted
 * global prototype cannot supply one. Accessors are rejected without being invoked.
 */
function resolveMethod(target: object, name: string): Method {
  let current: object | null = target;
  while (current !== null && current !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError('not a data method');
      }
      const method = descriptor.value as Method;
      return (...args) => Reflect.apply(method, target, args);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  throw new TypeError('missing method');
}

async function callPort(call: PortCall, invoke: () => unknown): Promise<Snapshot> {
  let result: unknown;
  try {
    result = await invoke();
  } catch (error) {
    const reason = portFailureReason(error);
    if (reason === undefined) {
      throw new ProvenanceError('UNTYPED_PORT_FAILURE', call);
    }
    if (call.side === 'github') {
      throw new ProvenanceError('GITHUB_PORT_FAILURE', { side: 'github', method: call.method, reason });
    }
    throw new ProvenanceError('LOCAL_PORT_FAILURE', { side: 'local', method: call.method, reason });
  }
  const snapshot = snapshotRecord(result);
  if (snapshot === undefined) {
    throw new ProvenanceError('INVALID_PORT_RESPONSE', call);
  }
  return snapshot;
}

/**
 * Required keys must be present and pass their check. Optional keys are left to a later
 * semantic check that has its own code. Any other key is malformed.
 */
function requireShape(
  record: Snapshot,
  call: PortCall,
  required: Readonly<Record<string, Check>>,
  optional: readonly string[] = [],
): void {
  const valid = Object.keys(record).every((key) => Object.hasOwn(required, key) || optional.includes(key))
    && Object.entries(required).every(([key, check]) => Object.hasOwn(record, key) && check(record[key]));
  if (!valid) {
    throw new ProvenanceError('INVALID_PORT_RESPONSE', call);
  }
}

function requireEcho(actual: unknown, expected: string, call: PortCall): void {
  if (actual !== expected) {
    throw new ProvenanceError('SUBJECT_ECHO_MISMATCH', call);
  }
}

async function sampleEnvironment(port: BoundPorts): Promise<Snapshot> {
  const environment = await callPort(GET_ENVIRONMENT, () => port.getEnvironment());
  requireShape(environment, GET_ENVIRONMENT,
    { replaceRefs: isEnvironmentState, alternates: isEnvironmentState }, ['objectFormat']);
  return environment;
}

async function requireObjectType(port: BoundPorts, oid: string, expected: 'commit' | 'tree'): Promise<void> {
  const object = await callPort(GET_OBJECT_TYPE, () => port.getObjectType(oid));
  requireShape(object, GET_OBJECT_TYPE, { oid: isString, type: isObjectType });
  requireEcho(object.oid, oid, GET_OBJECT_TYPE);
  if (object.type !== expected) {
    throw new ProvenanceError('OBJECT_TYPE_MISMATCH', { object: expected });
  }
}
