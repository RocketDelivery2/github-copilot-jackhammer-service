import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SkillApprovalCheckpoint, SkillApprovalState } from './types.js';

export type PersistedApprovalState = Exclude<SkillApprovalState, 'pending'>;

export type ApprovalStatePersistenceDecisionMetadata = {
  readonly decision?: 'approve' | 'reject' | 'reset';
  readonly reason?: string;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
};

export type ApprovalStatePersistenceEntry = {
  readonly checkpointId: string;
  readonly approvalState: PersistedApprovalState;
  readonly decision?: ApprovalStatePersistenceDecisionMetadata;
};

export type ApprovalStatePersistenceRecord = {
  readonly version: 1;
  readonly checkpoints: readonly ApprovalStatePersistenceEntry[];
};

const emptyApprovalStatePersistenceRecord = (): ApprovalStatePersistenceRecord => ({
  version: 1,
  checkpoints: [],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPersistedApprovalState(value: unknown): value is PersistedApprovalState {
  return value === 'approved' || value === 'rejected' || value === 'not_required';
}

function parseDecisionMetadata(value: unknown, checkpointId: string): ApprovalStatePersistenceDecisionMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`Malformed approval state persistence JSON: decision metadata for "${checkpointId}" must be an object`);
  }

  const decision = value.decision;
  if (decision !== undefined && decision !== 'approve' && decision !== 'reject' && decision !== 'reset') {
    throw new Error(`Malformed approval state persistence JSON: invalid decision metadata for "${checkpointId}"`);
  }

  for (const field of ['reason', 'decidedBy', 'decidedAt'] as const) {
    const fieldValue = value[field];
    if (fieldValue !== undefined && typeof fieldValue !== 'string') {
      throw new Error(`Malformed approval state persistence JSON: "${field}" for "${checkpointId}" must be a string`);
    }
  }

  return {
    ...(decision === undefined ? {} : { decision }),
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(typeof value.decidedBy === 'string' ? { decidedBy: value.decidedBy } : {}),
    ...(typeof value.decidedAt === 'string' ? { decidedAt: value.decidedAt } : {}),
  };
}

export function parseApprovalStatePersistence(value: unknown): ApprovalStatePersistenceRecord {
  if (!isRecord(value)) {
    throw new Error('Malformed approval state persistence JSON: expected an object');
  }

  if (value.version !== 1) {
    throw new Error('Malformed approval state persistence JSON: expected version 1');
  }

  if (!Array.isArray(value.checkpoints)) {
    throw new Error('Malformed approval state persistence JSON: expected checkpoints array');
  }

  const checkpoints = value.checkpoints.map((entry, index): ApprovalStatePersistenceEntry => {
    if (!isRecord(entry)) {
      throw new Error(`Malformed approval state persistence JSON: checkpoint entry ${index} must be an object`);
    }

    if (typeof entry.checkpointId !== 'string' || entry.checkpointId.trim().length === 0) {
      throw new Error(`Malformed approval state persistence JSON: checkpoint entry ${index} has invalid checkpointId`);
    }

    if (!isPersistedApprovalState(entry.approvalState)) {
      throw new Error(`Malformed approval state persistence JSON: checkpoint "${entry.checkpointId}" has invalid approvalState`);
    }

    return {
      checkpointId: entry.checkpointId,
      approvalState: entry.approvalState,
      ...(entry.decision === undefined ? {} : { decision: parseDecisionMetadata(entry.decision, entry.checkpointId) }),
    };
  });

  return {
    version: 1,
    checkpoints: [...checkpoints].sort((left, right) => left.checkpointId.localeCompare(right.checkpointId)),
  };
}

export async function loadApprovalStatePersistence(filePath: string): Promise<ApprovalStatePersistenceRecord> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parseApprovalStatePersistence(parsed);
  } catch (error) {
    if (isNodeMissingFileError(error)) {
      return emptyApprovalStatePersistenceRecord();
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Malformed approval state persistence JSON in ${filePath}: ${error.message}`);
    }

    throw error;
  }
}

export async function saveApprovalStatePersistence(
  filePath: string,
  record: ApprovalStatePersistenceRecord,
): Promise<void> {
  const parsed = parseApprovalStatePersistence(record);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

export function applyPersistedApprovalState(
  checkpoints: readonly SkillApprovalCheckpoint[],
  record: ApprovalStatePersistenceRecord,
): SkillApprovalCheckpoint[] {
  const persistedById = new Map(record.checkpoints.map(entry => [entry.checkpointId, entry.approvalState]));

  return checkpoints.map(checkpoint => {
    const approvalState = persistedById.get(checkpoint.checkpointId);
    if (approvalState === undefined) {
      return { ...checkpoint };
    }

    return {
      ...checkpoint,
      approvalState,
    };
  });
}

function isNodeMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
