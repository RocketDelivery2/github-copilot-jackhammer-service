export const PORT_FAILURE_REASONS = [
  'not-found',
  'unauthorized',
  'rate-limited',
  'unavailable',
  'ambiguous',
  'io-error',
] as const;

export type PortFailureReason = typeof PORT_FAILURE_REASONS[number];

const portErrors = new WeakSet<object>();

/** Thrown by evidence-port adapters. The verifier never throws it. */
export class ProvenancePortError extends Error {
  readonly reason: PortFailureReason;

  constructor(reason: PortFailureReason, message: string) {
    if (!(PORT_FAILURE_REASONS as readonly unknown[]).includes(reason)) {
      throw new TypeError('Unknown provenance port failure reason');
    }
    super(message);
    this.name = 'ProvenancePortError';
    this.reason = reason;
    Object.freeze(this);
    portErrors.add(this);
  }
}

/**
 * The reason of an error constructed by ProvenancePortError, or undefined for anything else.
 * A lookalike object with a `reason` property is untyped.
 */
export function portFailureReason(error: unknown): PortFailureReason | undefined {
  if (typeof error === 'object' && error !== null && portErrors.has(error)) {
    return (error as ProvenancePortError).reason;
  }
  return undefined;
}

export type GitHubPortMethod = 'getRepository' | 'getCommit';
export type LocalPortMethod = 'getEnvironment' | 'getObjectType' | 'getCommitTree';

export type PortCall =
  | { readonly side: 'github'; readonly method: GitHubPortMethod }
  | { readonly side: 'local'; readonly method: LocalPortMethod };

export type EnvironmentSafetyCheck = 'replaceRefs' | 'alternates';
export type UnsafeEnvironmentState = 'present' | 'unknown';

/** Closed, verifier-created details for each code. Never contains claim or evidence values. */
export interface ProvenanceErrorDetailsByCode {
  INVALID_SEED: { readonly reason: 'shape' | 'integrity' };
  INVALID_PORTS: { readonly reason: 'container' | 'method' };
  INVALID_PORT_RESPONSE: PortCall;
  UNTYPED_PORT_FAILURE: PortCall;
  GITHUB_PORT_FAILURE: {
    readonly side: 'github';
    readonly method: GitHubPortMethod;
    readonly reason: PortFailureReason;
  };
  LOCAL_PORT_FAILURE: {
    readonly side: 'local';
    readonly method: LocalPortMethod;
    readonly reason: PortFailureReason;
  };
  SUBJECT_ECHO_MISMATCH: PortCall;
  SCOPE_NOT_REPOSITORY_REACHABLE: { readonly side: 'github'; readonly method: 'getCommit' };
  OBJECT_FORMAT_MISMATCH: { readonly source: 'github' | 'local' };
  OBJECT_TYPE_MISMATCH: { readonly object: 'commit' | 'tree' };
  TREE_MISMATCH: { readonly source: 'github' | 'local' };
  ENVIRONMENT_UNSAFE: { readonly check: EnvironmentSafetyCheck; readonly state: UnsafeEnvironmentState };
  ENVIRONMENT_CHANGED:
    | { readonly check: EnvironmentSafetyCheck; readonly state: UnsafeEnvironmentState }
    | { readonly check: 'objectFormat' };
}

export type ProvenanceErrorCode = keyof ProvenanceErrorDetailsByCode;

const MESSAGES: Readonly<Record<ProvenanceErrorCode, string>> = Object.freeze({
  INVALID_SEED: 'seed is not a valid, intact RepoSeed of own data properties',
  INVALID_PORTS: 'evidence ports are missing or malformed',
  INVALID_PORT_RESPONSE: 'evidence port returned a malformed response',
  UNTYPED_PORT_FAILURE: 'evidence port failed with an untyped error',
  GITHUB_PORT_FAILURE: 'GitHub evidence port failed',
  LOCAL_PORT_FAILURE: 'local Git evidence port failed',
  SUBJECT_ECHO_MISMATCH: 'evidence does not describe the queried subject',
  SCOPE_NOT_REPOSITORY_REACHABLE: 'GitHub commit is not attested as reachable in this repository',
  OBJECT_FORMAT_MISMATCH: 'object format is missing, invalid or differs from the seed',
  OBJECT_TYPE_MISMATCH: 'local object has the wrong type',
  TREE_MISMATCH: 'commit root tree differs from the seed',
  ENVIRONMENT_UNSAFE: 'local repository environment is not safe to read',
  ENVIRONMENT_CHANGED: 'local repository environment changed during verification',
});

/** Every verification failure. The message names only the code, never claim or evidence values. */
export class ProvenanceError<C extends ProvenanceErrorCode = ProvenanceErrorCode> extends Error {
  readonly code: C;
  readonly details: ProvenanceErrorDetailsByCode[C];

  constructor(code: C, details: ProvenanceErrorDetailsByCode[C]) {
    super(`${code}: ${MESSAGES[code]}`);
    this.name = 'ProvenanceError';
    this.code = code;
    this.details = Object.freeze({ ...details }) as ProvenanceErrorDetailsByCode[C];
    Object.freeze(this);
  }
}
