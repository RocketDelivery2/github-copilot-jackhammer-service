import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ActiveWorkItem,
  CommandQueueItem,
  CopilotGuidance,
  CopilotResult,
  QueueState,
} from './types.js';

const DEFAULT_STATE: QueueState = {
  createdIssueHashes: {},
  commandQueue: [],
  recentCopilotResults: [],
};

export async function loadState(filePath: string): Promise<QueueState> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return normalizeState(parseStateFile(raw, filePath));
  } catch (error) {
    if (isMissingFileError(error)) {
      return normalizeState();
    }

    throw error;
  }
}

export async function saveState(filePath: string, state: QueueState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function normalizeState(state: unknown = {}): QueueState {
  const parsed = isRecord(state) ? state : {};
  const lastCommitSha = typeof parsed.lastCommitSha === 'string' ? parsed.lastCommitSha : undefined;
  const activeWorkItem = isActiveWorkItem(parsed.activeWorkItem) ? parsed.activeWorkItem : undefined;
  const extractedCopilotGuidance = isCopilotGuidance(parsed.extractedCopilotGuidance)
    ? parsed.extractedCopilotGuidance
    : undefined;

  return {
    createdIssueHashes: normalizeCreatedIssueHashes(parsed.createdIssueHashes),
    ...(lastCommitSha ? { lastCommitSha } : {}),
    ...(activeWorkItem ? { activeWorkItem } : {}),
    commandQueue: Array.isArray(parsed.commandQueue)
      ? parsed.commandQueue.filter(isCommandQueueItem)
      : [...DEFAULT_STATE.commandQueue],
    ...(extractedCopilotGuidance ? { extractedCopilotGuidance } : {}),
    recentCopilotResults: Array.isArray(parsed.recentCopilotResults)
      ? parsed.recentCopilotResults.filter(isCopilotResult)
      : [...DEFAULT_STATE.recentCopilotResults],
  };
}

function parseStateFile(raw: string, filePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown JSON parse error';
    throw new Error(`State file ${filePath} contains invalid JSON: ${reason}`);
  }

  if (!isRecord(parsed)) {
    throw new TypeError(`State file ${filePath} must contain a JSON object.`);
  }

  return parsed;
}

function normalizeCreatedIssueHashes(
  value: unknown,
): QueueState['createdIssueHashes'] {
  if (!isRecord(value)) {
    return { ...DEFAULT_STATE.createdIssueHashes };
  }

  const normalized: QueueState['createdIssueHashes'] = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isCreatedIssueHashEntry(entry)) {
      normalized[key] = entry;
    }
  }

  return normalized;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCreatedIssueHashEntry(
  value: unknown,
): value is QueueState['createdIssueHashes'][string] {
  return isRecord(value)
    && typeof value.issueNumber === 'number'
    && typeof value.url === 'string'
    && typeof value.title === 'string'
    && typeof value.createdAt === 'string';
}

function isActiveWorkItem(value: unknown): value is ActiveWorkItem {
  return isRecord(value)
    && typeof value.issueNumber === 'number'
    && typeof value.issueUrl === 'string'
    && typeof value.title === 'string'
    && typeof value.startedAt === 'string'
    && (value.linkedPRNumber === undefined || typeof value.linkedPRNumber === 'number')
    && (value.linkedPRUrl === undefined || typeof value.linkedPRUrl === 'string');
}

function isCommandQueueItem(value: unknown): value is CommandQueueItem {
  return isRecord(value)
    && typeof value.hash === 'string'
    && typeof value.title === 'string'
    && isPriority(value.priority)
    && typeof value.prompt === 'string'
    && (value.issueNumber === undefined || typeof value.issueNumber === 'number')
    && (value.issueUrl === undefined || typeof value.issueUrl === 'string');
}

function isCopilotGuidance(value: unknown): value is CopilotGuidance {
  return isRecord(value)
    && isStringArray(value.planSteps)
    && (value.recommendedNextPR === null || typeof value.recommendedNextPR === 'string')
    && isStringArray(value.notes)
    && isStringArray(value.validation)
    && isStringArray(value.blockers)
    && isStringArray(value.errors)
    && typeof value.hasCopilotQuestion === 'boolean'
    && typeof value.rawText === 'string'
    && typeof value.extractedAt === 'string';
}

function isCopilotResult(value: unknown): value is CopilotResult {
  return isRecord(value)
    && typeof value.issueNumber === 'number'
    && typeof value.title === 'string'
    && isOutcome(value.outcome)
    && typeof value.summary === 'string'
    && typeof value.recordedAt === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isPriority(value: unknown): value is CommandQueueItem['priority'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isOutcome(value: unknown): value is CopilotResult['outcome'] {
  return value === 'merged'
    || value === 'question'
    || value === 'error'
    || value === 'blocked'
    || value === 'pending';
}
