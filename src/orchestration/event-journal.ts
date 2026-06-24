import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ExecutionEvent,
  ExecutionEventKind,
  QueueSignal,
  QueueSignalKind,
  QueueSignalSeverity,
} from './types.js';

export type EventJournalRecordType =
  | 'execution_event'
  | 'queue_signal'
  | 'skill_selection'
  | 'skill_execution_plan'
  | 'skill_approval_checkpoint';

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

export type SkillSelectionRisk = 'low' | 'medium' | 'high';

export type EventJournalSkillSelectionRecord = {
  type: 'skill_selection';
  createdAt: string;
  source: string;
  workItemId?: string;
  selection: {
    taskId: string;
    skillName: string;
    rank: number;
    score: number;
    reasons: string[];
    risk: SkillSelectionRisk;
    allowedTools: string[];
    trustPolicySummary: {
      instructionsReadAllowed: boolean;
      referencesReadAllowed: boolean;
      assetsReadAllowed: boolean;
      scriptsRequireHumanApproval: boolean;
      scriptsAutoExecutable: boolean;
    };
  };
};

export type EventJournalSkillExecutionPlanRecord = {
  type: 'skill_execution_plan';
  createdAt: string;
  source: string;
  workItemId?: string;
  plan: {
    taskId: string;
    skillName: string;
    selectionRank: number;
    selectionScore: number;
    selectionReasons: string[];
    risk: SkillSelectionRisk;
    allowedTools: string[];
    plannedSteps: Array<{ index: number; summary: string }>;
    trustPolicySummary: {
      instructionsReadAllowed: boolean;
      referencesReadAllowed: boolean;
      assetsReadAllowed: boolean;
      scriptsRequireHumanApproval: boolean;
      scriptsAutoExecutable: boolean;
      scriptExecutionBlocked: boolean;
    };
  };
};

export type SkillApprovalResourceType = 'script' | 'reference' | 'instructions' | 'risk_gate';
export type SkillApprovalState = 'pending' | 'approved' | 'rejected' | 'not_required';

export type EventJournalSkillApprovalCheckpointRecord = {
  type: 'skill_approval_checkpoint';
  createdAt: string;
  source: string;
  workItemId?: string;
  checkpoint: {
    checkpointId: string;
    taskId: string;
    skillName: string;
    resourceType: SkillApprovalResourceType;
    reason: string;
    risk: SkillSelectionRisk;
    approvalState: SkillApprovalState;
    createdSource: 'adaptive-preview';
  };
};

export type EventJournalRecord =
  | EventJournalExecutionEventRecord
  | EventJournalQueueSignalRecord
  | EventJournalSkillSelectionRecord
  | EventJournalSkillExecutionPlanRecord
  | EventJournalSkillApprovalCheckpointRecord;

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

export type CreateSkillSelectionJournalRecordInput = {
  createdAt: string;
  source: string;
  workItemId?: string;
  selection: {
    taskId: string;
    skillName: string;
    rank: number;
    score: number;
    reasons: readonly string[];
    risk: SkillSelectionRisk;
    allowedTools: readonly string[];
    trustPolicySummary: {
      instructionsReadAllowed: boolean;
      referencesReadAllowed: boolean;
      assetsReadAllowed: boolean;
      scriptsRequireHumanApproval: boolean;
      scriptsAutoExecutable: boolean;
    };
  };
};

export type CreateSkillExecutionPlanJournalRecordInput = {
  createdAt: string;
  source: string;
  workItemId?: string;
  plan: {
    taskId: string;
    skillName: string;
    selectionRank: number;
    selectionScore: number;
    selectionReasons: readonly string[];
    risk: SkillSelectionRisk;
    allowedTools: readonly string[];
    plannedSteps: ReadonlyArray<{ index: number; summary: string }>;
    trustPolicySummary: {
      instructionsReadAllowed: boolean;
      referencesReadAllowed: boolean;
      assetsReadAllowed: boolean;
      scriptsRequireHumanApproval: boolean;
      scriptsAutoExecutable: boolean;
      scriptExecutionBlocked: boolean;
    };
  };
};

export type CreateSkillApprovalCheckpointJournalRecordInput = {
  createdAt: string;
  source: string;
  workItemId?: string;
  checkpoint: {
    checkpointId: string;
    taskId: string;
    skillName: string;
    resourceType: SkillApprovalResourceType;
    reason: string;
    risk: SkillSelectionRisk;
    approvalState: SkillApprovalState;
    createdSource: 'adaptive-preview';
  };
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

const SKILL_SELECTION_RISKS = new Set<SkillSelectionRisk>(['low', 'medium', 'high']);
const SKILL_APPROVAL_RESOURCE_TYPES = new Set<SkillApprovalResourceType>([
  'script',
  'reference',
  'instructions',
  'risk_gate',
]);
const SKILL_APPROVAL_STATES = new Set<SkillApprovalState>([
  'pending',
  'approved',
  'rejected',
  'not_required',
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

export function createSkillSelectionJournalRecord(
  input: CreateSkillSelectionJournalRecordInput,
): EventJournalSkillSelectionRecord {
  const workItemId = input.workItemId ?? input.selection.taskId;
  const record: EventJournalSkillSelectionRecord = {
    type: 'skill_selection',
    createdAt: input.createdAt,
    source: input.source,
    ...(workItemId ? { workItemId } : {}),
    selection: {
      taskId: input.selection.taskId,
      skillName: input.selection.skillName,
      rank: input.selection.rank,
      score: input.selection.score,
      reasons: [...input.selection.reasons],
      risk: input.selection.risk,
      allowedTools: [...input.selection.allowedTools],
      trustPolicySummary: {
        instructionsReadAllowed: input.selection.trustPolicySummary.instructionsReadAllowed,
        referencesReadAllowed: input.selection.trustPolicySummary.referencesReadAllowed,
        assetsReadAllowed: input.selection.trustPolicySummary.assetsReadAllowed,
        scriptsRequireHumanApproval: input.selection.trustPolicySummary.scriptsRequireHumanApproval,
        scriptsAutoExecutable: input.selection.trustPolicySummary.scriptsAutoExecutable,
      },
    },
  };

  return parseJournalRecord(record, 'event journal input', 0) as EventJournalSkillSelectionRecord;
}

export function createSkillExecutionPlanJournalRecord(
  input: CreateSkillExecutionPlanJournalRecordInput,
): EventJournalSkillExecutionPlanRecord {
  const workItemId = input.workItemId ?? input.plan.taskId;
  const record: EventJournalSkillExecutionPlanRecord = {
    type: 'skill_execution_plan',
    createdAt: input.createdAt,
    source: input.source,
    ...(workItemId ? { workItemId } : {}),
    plan: {
      taskId: input.plan.taskId,
      skillName: input.plan.skillName,
      selectionRank: input.plan.selectionRank,
      selectionScore: input.plan.selectionScore,
      selectionReasons: [...input.plan.selectionReasons],
      risk: input.plan.risk,
      allowedTools: [...input.plan.allowedTools],
      plannedSteps: input.plan.plannedSteps.map(step => ({ index: step.index, summary: step.summary })),
      trustPolicySummary: {
        instructionsReadAllowed: input.plan.trustPolicySummary.instructionsReadAllowed,
        referencesReadAllowed: input.plan.trustPolicySummary.referencesReadAllowed,
        assetsReadAllowed: input.plan.trustPolicySummary.assetsReadAllowed,
        scriptsRequireHumanApproval: input.plan.trustPolicySummary.scriptsRequireHumanApproval,
        scriptsAutoExecutable: input.plan.trustPolicySummary.scriptsAutoExecutable,
        scriptExecutionBlocked: input.plan.trustPolicySummary.scriptExecutionBlocked,
      },
    },
  };

  return parseJournalRecord(record, 'event journal input', 0) as EventJournalSkillExecutionPlanRecord;
}

export function createSkillApprovalCheckpointJournalRecord(
  input: CreateSkillApprovalCheckpointJournalRecordInput,
): EventJournalSkillApprovalCheckpointRecord {
  const workItemId = input.workItemId ?? input.checkpoint.taskId;
  const record: EventJournalSkillApprovalCheckpointRecord = {
    type: 'skill_approval_checkpoint',
    createdAt: input.createdAt,
    source: input.source,
    ...(workItemId ? { workItemId } : {}),
    checkpoint: {
      checkpointId: input.checkpoint.checkpointId,
      taskId: input.checkpoint.taskId,
      skillName: input.checkpoint.skillName,
      resourceType: input.checkpoint.resourceType,
      reason: input.checkpoint.reason,
      risk: input.checkpoint.risk,
      approvalState: input.checkpoint.approvalState,
      createdSource: input.checkpoint.createdSource,
    },
  };

  return parseJournalRecord(record, 'event journal input', 0) as EventJournalSkillApprovalCheckpointRecord;
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

  if (type === 'skill_selection') {
    return {
      type,
      createdAt,
      source,
      ...(workItemId ? { workItemId } : {}),
      selection: parseSkillSelection(value.selection, filePath, `${context}.selection`),
    };
  }

  if (type === 'skill_execution_plan') {
    return {
      type,
      createdAt,
      source,
      ...(workItemId ? { workItemId } : {}),
      plan: parseSkillExecutionPlan(value.plan, filePath, `${context}.plan`),
    };
  }

  if (type === 'skill_approval_checkpoint') {
    return {
      type,
      createdAt,
      source,
      ...(workItemId ? { workItemId } : {}),
      checkpoint: parseSkillApprovalCheckpoint(value.checkpoint, filePath, `${context}.checkpoint`),
    };
  }

  throw malformedJournalError(
    filePath,
    `${context}.type must be execution_event, queue_signal, skill_selection, skill_execution_plan, or skill_approval_checkpoint`,
  );
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

function parseSkillSelection(
  value: unknown,
  filePath: string,
  context: string,
): EventJournalSkillSelectionRecord['selection'] {
  if (!isRecord(value)) {
    throw malformedJournalError(filePath, `${context} must be an object`);
  }

  const taskId = requireNonEmptyString(value.taskId, filePath, `${context}.taskId`);
  const skillName = requireNonEmptyString(value.skillName, filePath, `${context}.skillName`);
  const rank = requireNonNegativeInteger(value.rank, filePath, `${context}.rank`);
  const score = requireFiniteNumber(value.score, filePath, `${context}.score`);
  const risk = requireString(value.risk, filePath, `${context}.risk`);
  if (!SKILL_SELECTION_RISKS.has(risk as SkillSelectionRisk)) {
    throw malformedJournalError(filePath, `${context}.risk is not a known skill selection risk`);
  }

  const reasons = requireStringArray(value.reasons, filePath, `${context}.reasons`);
  const allowedTools = requireStringArray(value.allowedTools, filePath, `${context}.allowedTools`);

  if (!isRecord(value.trustPolicySummary)) {
    throw malformedJournalError(filePath, `${context}.trustPolicySummary must be an object`);
  }
  const trustPolicySummary = value.trustPolicySummary;

  return {
    taskId,
    skillName,
    rank,
    score,
    reasons,
    risk: risk as SkillSelectionRisk,
    allowedTools,
    trustPolicySummary: {
      instructionsReadAllowed: requireBoolean(
        trustPolicySummary.instructionsReadAllowed,
        filePath,
        `${context}.trustPolicySummary.instructionsReadAllowed`,
      ),
      referencesReadAllowed: requireBoolean(
        trustPolicySummary.referencesReadAllowed,
        filePath,
        `${context}.trustPolicySummary.referencesReadAllowed`,
      ),
      assetsReadAllowed: requireBoolean(
        trustPolicySummary.assetsReadAllowed,
        filePath,
        `${context}.trustPolicySummary.assetsReadAllowed`,
      ),
      scriptsRequireHumanApproval: requireBoolean(
        trustPolicySummary.scriptsRequireHumanApproval,
        filePath,
        `${context}.trustPolicySummary.scriptsRequireHumanApproval`,
      ),
      scriptsAutoExecutable: requireBoolean(
        trustPolicySummary.scriptsAutoExecutable,
        filePath,
        `${context}.trustPolicySummary.scriptsAutoExecutable`,
      ),
    },
  };
}

function parseSkillExecutionPlan(
  value: unknown,
  filePath: string,
  context: string,
): EventJournalSkillExecutionPlanRecord['plan'] {
  if (!isRecord(value)) {
    throw malformedJournalError(filePath, `${context} must be an object`);
  }

  const taskId = requireNonEmptyString(value.taskId, filePath, `${context}.taskId`);
  const skillName = requireNonEmptyString(value.skillName, filePath, `${context}.skillName`);
  const selectionRank = requireNonNegativeInteger(value.selectionRank, filePath, `${context}.selectionRank`);
  const selectionScore = requireFiniteNumber(value.selectionScore, filePath, `${context}.selectionScore`);
  const risk = requireString(value.risk, filePath, `${context}.risk`);
  if (!SKILL_SELECTION_RISKS.has(risk as SkillSelectionRisk)) {
    throw malformedJournalError(filePath, `${context}.risk is not a known skill selection risk`);
  }

  const selectionReasons = requireStringArray(value.selectionReasons, filePath, `${context}.selectionReasons`);
  const allowedTools = requireStringArray(value.allowedTools, filePath, `${context}.allowedTools`);
  const plannedSteps = requireSkillExecutionPlanSteps(value.plannedSteps, filePath, `${context}.plannedSteps`);

  if (!isRecord(value.trustPolicySummary)) {
    throw malformedJournalError(filePath, `${context}.trustPolicySummary must be an object`);
  }
  const trustPolicySummary = value.trustPolicySummary;

  return {
    taskId,
    skillName,
    selectionRank,
    selectionScore,
    selectionReasons,
    risk: risk as SkillSelectionRisk,
    allowedTools,
    plannedSteps,
    trustPolicySummary: {
      instructionsReadAllowed: requireBoolean(
        trustPolicySummary.instructionsReadAllowed,
        filePath,
        `${context}.trustPolicySummary.instructionsReadAllowed`,
      ),
      referencesReadAllowed: requireBoolean(
        trustPolicySummary.referencesReadAllowed,
        filePath,
        `${context}.trustPolicySummary.referencesReadAllowed`,
      ),
      assetsReadAllowed: requireBoolean(
        trustPolicySummary.assetsReadAllowed,
        filePath,
        `${context}.trustPolicySummary.assetsReadAllowed`,
      ),
      scriptsRequireHumanApproval: requireBoolean(
        trustPolicySummary.scriptsRequireHumanApproval,
        filePath,
        `${context}.trustPolicySummary.scriptsRequireHumanApproval`,
      ),
      scriptsAutoExecutable: requireBoolean(
        trustPolicySummary.scriptsAutoExecutable,
        filePath,
        `${context}.trustPolicySummary.scriptsAutoExecutable`,
      ),
      scriptExecutionBlocked: requireBoolean(
        trustPolicySummary.scriptExecutionBlocked,
        filePath,
        `${context}.trustPolicySummary.scriptExecutionBlocked`,
      ),
    },
  };
}

function parseSkillApprovalCheckpoint(
  value: unknown,
  filePath: string,
  context: string,
): EventJournalSkillApprovalCheckpointRecord['checkpoint'] {
  if (!isRecord(value)) {
    throw malformedJournalError(filePath, `${context} must be an object`);
  }

  const checkpointId = requireNonEmptyString(value.checkpointId, filePath, `${context}.checkpointId`);
  const taskId = requireNonEmptyString(value.taskId, filePath, `${context}.taskId`);
  const skillName = requireNonEmptyString(value.skillName, filePath, `${context}.skillName`);
  const resourceType = requireString(value.resourceType, filePath, `${context}.resourceType`);
  if (!SKILL_APPROVAL_RESOURCE_TYPES.has(resourceType as SkillApprovalResourceType)) {
    throw malformedJournalError(filePath, `${context}.resourceType is not a known skill approval resource type`);
  }
  const reason = requireNonEmptyString(value.reason, filePath, `${context}.reason`);
  const risk = requireString(value.risk, filePath, `${context}.risk`);
  if (!SKILL_SELECTION_RISKS.has(risk as SkillSelectionRisk)) {
    throw malformedJournalError(filePath, `${context}.risk is not a known skill selection risk`);
  }
  const approvalState = requireString(value.approvalState, filePath, `${context}.approvalState`);
  if (!SKILL_APPROVAL_STATES.has(approvalState as SkillApprovalState)) {
    throw malformedJournalError(filePath, `${context}.approvalState is not a known approval state`);
  }
  const createdSource = requireString(value.createdSource, filePath, `${context}.createdSource`);
  if (createdSource !== 'adaptive-preview') {
    throw malformedJournalError(filePath, `${context}.createdSource must be adaptive-preview`);
  }

  return {
    checkpointId,
    taskId,
    skillName,
    resourceType: resourceType as SkillApprovalResourceType,
    reason,
    risk: risk as SkillSelectionRisk,
    approvalState: approvalState as SkillApprovalState,
    createdSource: createdSource as 'adaptive-preview',
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

  if (record.type === 'skill_selection') {
    return {
      type: record.type,
      createdAt: record.createdAt,
      source: record.source,
      ...(record.workItemId ? { workItemId: record.workItemId } : {}),
      selection: {
        taskId: record.selection.taskId,
        skillName: record.selection.skillName,
        rank: record.selection.rank,
        score: record.selection.score,
        reasons: [...record.selection.reasons],
        risk: record.selection.risk,
        allowedTools: [...record.selection.allowedTools],
        trustPolicySummary: {
          instructionsReadAllowed: record.selection.trustPolicySummary.instructionsReadAllowed,
          referencesReadAllowed: record.selection.trustPolicySummary.referencesReadAllowed,
          assetsReadAllowed: record.selection.trustPolicySummary.assetsReadAllowed,
          scriptsRequireHumanApproval: record.selection.trustPolicySummary.scriptsRequireHumanApproval,
          scriptsAutoExecutable: record.selection.trustPolicySummary.scriptsAutoExecutable,
        },
      },
    };
  }

  if (record.type === 'skill_execution_plan') {
    return {
      type: record.type,
      createdAt: record.createdAt,
      source: record.source,
      ...(record.workItemId ? { workItemId: record.workItemId } : {}),
      plan: {
        taskId: record.plan.taskId,
        skillName: record.plan.skillName,
        selectionRank: record.plan.selectionRank,
        selectionScore: record.plan.selectionScore,
        selectionReasons: [...record.plan.selectionReasons],
        risk: record.plan.risk,
        allowedTools: [...record.plan.allowedTools],
        plannedSteps: record.plan.plannedSteps.map(step => ({ index: step.index, summary: step.summary })),
        trustPolicySummary: {
          instructionsReadAllowed: record.plan.trustPolicySummary.instructionsReadAllowed,
          referencesReadAllowed: record.plan.trustPolicySummary.referencesReadAllowed,
          assetsReadAllowed: record.plan.trustPolicySummary.assetsReadAllowed,
          scriptsRequireHumanApproval: record.plan.trustPolicySummary.scriptsRequireHumanApproval,
          scriptsAutoExecutable: record.plan.trustPolicySummary.scriptsAutoExecutable,
          scriptExecutionBlocked: record.plan.trustPolicySummary.scriptExecutionBlocked,
        },
      },
    };
  }

  if (record.type === 'skill_approval_checkpoint') {
    return {
      type: record.type,
      createdAt: record.createdAt,
      source: record.source,
      ...(record.workItemId ? { workItemId: record.workItemId } : {}),
      checkpoint: {
        checkpointId: record.checkpoint.checkpointId,
        taskId: record.checkpoint.taskId,
        skillName: record.checkpoint.skillName,
        resourceType: record.checkpoint.resourceType,
        reason: record.checkpoint.reason,
        risk: record.checkpoint.risk,
        approvalState: record.checkpoint.approvalState,
        createdSource: record.checkpoint.createdSource,
      },
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

function requireFiniteNumber(value: unknown, filePath: string, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformedJournalError(filePath, `${context} must be a finite number`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, filePath: string, context: string): number {
  const number = requireFiniteNumber(value, filePath, context);
  if (!Number.isInteger(number) || number < 0) {
    throw malformedJournalError(filePath, `${context} must be a non-negative integer`);
  }
  return number;
}

function requireBoolean(value: unknown, filePath: string, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw malformedJournalError(filePath, `${context} must be a boolean`);
  }
  return value;
}

function requireStringArray(value: unknown, filePath: string, context: string): string[] {
  if (!Array.isArray(value)) {
    throw malformedJournalError(filePath, `${context} must be an array`);
  }

  return value.map((entry, index) => requireString(entry, filePath, `${context}[${index}]`));
}

function requireSkillExecutionPlanSteps(
  value: unknown,
  filePath: string,
  context: string,
): Array<{ index: number; summary: string }> {
  if (!Array.isArray(value)) {
    throw malformedJournalError(filePath, `${context} must be an array`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw malformedJournalError(filePath, `${context}[${index}] must be an object`);
    }

    return {
      index: requireNonNegativeInteger(entry.index, filePath, `${context}[${index}].index`),
      summary: requireNonEmptyString(entry.summary, filePath, `${context}[${index}].summary`),
    };
  });
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
