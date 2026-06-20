import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ExecutionEvent,
  ExecutionEventKind,
  QueueSignal,
  QueueSignalKind,
  QueueSignalSeverity,
} from './types.js';

export type EventJournalRecordType = 'execution_event' | 'queue_signal';

export type EventJournalExecutionEventRecord = {
  type: 'execution_event';
  createdAt: string;
  source: string;
  workItemId?: string;
  event: ExecutionEvent;
};

export type EventJournalQueueSignalRecord = {
  type: 'queue_signal';
  createdAt: string;
  source: string;
  workItemId?: string;
  signal: QueueSignal;
};

export type EventJournalRecord =
  | EventJournalExecutionEventRecord
  | EventJournalQueueSignalRecord;

export type CreateExecutionEventJournalRecordInput = {
  createdAt: string;
  source: string;
  workItemId?: string;
  event: ExecutionEvent;
};

export type CreateQueueSignalJournalRecordInput = {
  createdAt: string;
  source: string;
  workItemId?: string;
  signal: QueueSignal;
};

export type AppendEventJournalOptions = {
  retentionLimit?: number;
};

const EXECUTION_EVENT_KINDS = new Set<ExecutionEventKind>([
  'started',
  'stdout',
  'stderr',
  'exit',
  'completed',
  'failed',
]);

const QUEUE_SIGNAL_KINDS = new Set<QueueSignalKind>([
  'build_failure',
  'test_failure',
  'lint_failure',
  'agent_question',
  'missing_tests',
  'needs_research',
  'needs_architect_decision',
  'urgent',
  'blocker',
]);

const QUEUE_SIGNAL_SEVERITIES = new Set<QueueSignalSeverity>([
  'info',
  'warning',
  'error',
]);

export async function loadEventJournal(filePath: string): Promise<EventJournalRecord[]> {
  let contents: string;

  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw malformedJournalError(filePath, 'invalid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw malformedJournalError(filePath, 'expected a JSON array');
  }

  return parsed.map((record, index) => parseJournalRecord(record, filePath, index));
}

export async function appendEventJournalRecords(
  filePath: string,
  records: readonly EventJournalRecord[],
  options: AppendEventJournalOptions = {},
): Promise<EventJournalRecord[]> {
  const existing = await loadEventJournal(filePath);
  const nextRecords = applyEventJournalRetention(
    [...existing, ...records.map(cloneJournalRecord)],
    options.retentionLimit,
  );

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(nextRecords, null, 2)}\n`, 'utf8');

  return nextRecords;
}

export function createExecutionEventJournalRecord(
  input: CreateExecutionEventJournalRecordInput,
): EventJournalExecutionEventRecord {
  const workItemId = input.workItemId ?? input.event.workItemId;
  const record: EventJournalExecutionEventRecord = {
    type: 'execution_event',
    createdAt: input.createdAt,
    source: input.source,
    ...(workItemId ? { workItemId } : {}),
    event: cloneExecutionEvent(input.event),
  };

  return parseJournalRecord(record, 'event journal input', 0) as EventJournalExecutionEventRecord;
}

export function createQueueSignalJournalRecord(
  input: CreateQueueSignalJournalRecordInput,
): EventJournalQueueSignalRecord {
  const workItemId = input.workItemId ?? input.signal.workItemId;
  const record: EventJournalQueueSignalRecord = {
    type: 'queue_signal',
    createdAt: input.createdAt,
    source: input.source,
    ...(workItemId ? { workItemId } : {}),
    signal: cloneQueueSignal(input.signal),
  };

  return parseJournalRecord(record, 'event journal input', 0) as EventJournalQueueSignalRecord;
}

export function applyEventJournalRetention(
  records: readonly EventJournalRecord[],
  retentionLimit?: number,
): EventJournalRecord[] {
  if (retentionLimit === undefined) {
    return records.map(cloneJournalRecord);
  }

  if (!Number.isInteger(retentionLimit) || retentionLimit < 0) {
    throw new RangeError('retentionLimit must be a non-negative integer.');
  }

  if (retentionLimit === 0) {
    return [];
  }

  return records.slice(-retentionLimit).map(cloneJournalRecord);
}

function parseJournalRecord(
  value: unknown,
  filePath: string,
  index: number,
): EventJournalRecord {
  const context = `${filePath} record ${index}`;
  if (!isRecord(value)) {
    throw malformedJournalError(filePath, `record ${index} must be an object`);
  }

  const type = requireString(value.type, filePath, `${context}.type`);
  const createdAt = requireTimestamp(value.createdAt, filePath, `${context}.createdAt`);
  const source = requireNonEmptyString(value.source, filePath, `${context}.source`);
  const workItemId = optionalNonEmptyString(value.workItemId, filePath, `${context}.workItemId`);

  if (type === 'execution_event') {
    return {
      type,
      createdAt,
      source,
      ...(workItemId ? { workItemId } : {}),
      event: parseExecutionEvent(value.event, filePath, `${context}.event`),
    };
  }

  if (type === 'queue_signal') {
    return {
      type,
      createdAt,
      source,
      ...(workItemId ? { workItemId } : {}),
      signal: parseQueueSignal(value.signal, filePath, `${context}.signal`),
    };
  }

  throw malformedJournalError(filePath, `${context}.type must be execution_event or queue_signal`);
}

function parseExecutionEvent(value: unknown, filePath: string, context: string): ExecutionEvent {
  if (!isRecord(value)) {
    throw malformedJournalError(filePath, `${context} must be an object`);
  }

  const workItemId = requireNonEmptyString(value.workItemId, filePath, `${context}.workItemId`);
  const kind = requireString(value.kind, filePath, `${context}.kind`);
  if (!EXECUTION_EVENT_KINDS.has(kind as ExecutionEventKind)) {
    throw malformedJournalError(filePath, `${context}.kind is not a known execution event kind`);
  }

  const stdout = optionalString(value.stdout, filePath, `${context}.stdout`);
  const stderr = optionalString(value.stderr, filePath, `${context}.stderr`);
  const exitCode = optionalNumber(value.exitCode, filePath, `${context}.exitCode`);
  const message = optionalString(value.message, filePath, `${context}.message`);

  return {
    workItemId,
    kind: kind as ExecutionEventKind,
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(message !== undefined ? { message } : {}),
  };
}

function parseQueueSignal(value: unknown, filePath: string, context: string): QueueSignal {
  if (!isRecord(value)) {
    throw malformedJournalError(filePath, `${context} must be an object`);
  }

  const kind = requireString(value.kind, filePath, `${context}.kind`);
  if (!QUEUE_SIGNAL_KINDS.has(kind as QueueSignalKind)) {
    throw malformedJournalError(filePath, `${context}.kind is not a known queue signal kind`);
  }

  const severity = requireString(value.severity, filePath, `${context}.severity`);
  if (!QUEUE_SIGNAL_SEVERITIES.has(severity as QueueSignalSeverity)) {
    throw malformedJournalError(filePath, `${context}.severity is not a known queue signal severity`);
  }

  const message = requireNonEmptyString(value.message, filePath, `${context}.message`);
  const workItemId = optionalNonEmptyString(value.workItemId, filePath, `${context}.workItemId`);
  const targetItemId = optionalNonEmptyString(value.targetItemId, filePath, `${context}.targetItemId`);
  const evidence = optionalString(value.evidence, filePath, `${context}.evidence`);

  return {
    kind: kind as QueueSignalKind,
    severity: severity as QueueSignalSeverity,
    message,
    ...(workItemId ? { workItemId } : {}),
    ...(targetItemId ? { targetItemId } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
  };
}

function cloneJournalRecord(record: EventJournalRecord): EventJournalRecord {
  if (record.type === 'execution_event') {
    return {
      type: record.type,
      createdAt: record.createdAt,
      source: record.source,
      ...(record.workItemId ? { workItemId: record.workItemId } : {}),
      event: cloneExecutionEvent(record.event),
    };
  }

  return {
    type: record.type,
    createdAt: record.createdAt,
    source: record.source,
    ...(record.workItemId ? { workItemId: record.workItemId } : {}),
    signal: cloneQueueSignal(record.signal),
  };
}

function cloneExecutionEvent(event: ExecutionEvent): ExecutionEvent {
  return {
    workItemId: event.workItemId,
    kind: event.kind,
    ...(event.stdout !== undefined ? { stdout: event.stdout } : {}),
    ...(event.stderr !== undefined ? { stderr: event.stderr } : {}),
    ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
    ...(event.message !== undefined ? { message: event.message } : {}),
  };
}

function cloneQueueSignal(signal: QueueSignal): QueueSignal {
  return {
    kind: signal.kind,
    severity: signal.severity,
    message: signal.message,
    ...(signal.workItemId ? { workItemId: signal.workItemId } : {}),
    ...(signal.targetItemId ? { targetItemId: signal.targetItemId } : {}),
    ...(signal.evidence !== undefined ? { evidence: signal.evidence } : {}),
  };
}

function requireTimestamp(
  value: unknown,
  filePath: string,
  context: string,
): string {
  const timestamp = requireNonEmptyString(value, filePath, context);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw malformedJournalError(filePath, `${context} must be a timestamp string`);
  }
  return timestamp;
}

function requireNonEmptyString(
  value: unknown,
  filePath: string,
  context: string,
): string {
  const text = requireString(value, filePath, context);
  if (text.trim().length === 0) {
    throw malformedJournalError(filePath, `${context} must be a non-empty string`);
  }
  return text;
}

function requireString(value: unknown, filePath: string, context: string): string {
  if (typeof value !== 'string') {
    throw malformedJournalError(filePath, `${context} must be a string`);
  }
  return value;
}

function optionalNonEmptyString(
  value: unknown,
  filePath: string,
  context: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, filePath, context);
}

function optionalString(value: unknown, filePath: string, context: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, filePath, context);
}

function optionalNumber(value: unknown, filePath: string, context: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformedJournalError(filePath, `${context} must be a finite number`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function malformedJournalError(filePath: string, reason: string): Error {
  return new Error(`Malformed event journal at ${filePath}: ${reason}.`);
}
