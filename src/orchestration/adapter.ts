import { planRunnableBatch } from './parallelism.js';
import { rebalanceWorkItems } from './rebalance.js';
import { classifyExecutionSignals } from './signals.js';
import {
  appendEventJournalRecords,
  createExecutionEventJournalRecord,
  createQueueSignalJournalRecord,
} from './event-journal.js';
import type { ActiveWorkItem, CommandQueueItem, CopilotGuidance, CopilotResult } from '../types.js';
import type { EventJournalRecord } from './event-journal.js';
import type { ExecutionEvent, QueueSignal, WorkItem } from './types.js';

export type AdaptiveQueueRuntimeInputs = {
  activeWorkItem?: ActiveWorkItem;
  commandQueue?: readonly CommandQueueItem[];
  guidance?: CopilotGuidance | null;
  recentResults?: readonly CopilotResult[];
  executionEvents?: readonly ExecutionEvent[];
  queueSignals?: readonly QueueSignal[];
};

export type AdaptiveScheduler = (
  workItems: readonly WorkItem[],
  signals: readonly QueueSignal[],
) => readonly WorkItem[];

export type AdaptiveQueuePreviewOptions = {
  enabled: boolean;
  maxParallel?: number;
  scheduler?: AdaptiveScheduler;
};

export type AdaptiveQueuePreview = {
  mode: 'legacy' | 'adaptive-preview';
  schedulerInvoked: boolean;
  workItems: WorkItem[];
  executionEvents: ExecutionEvent[];
  signals: QueueSignal[];
  scheduledWorkItemIds: string[];
};

export type AdaptivePreviewJournalOptions = {
  enabled: boolean;
  journalPath: string;
  retentionLimit?: number;
  source?: string;
  now?: () => string;
  appendRecords?: (
    filePath: string,
    records: readonly EventJournalRecord[],
    options?: { retentionLimit?: number },
  ) => Promise<EventJournalRecord[]>;
};

export function createAdaptiveQueuePreview(
  inputs: AdaptiveQueueRuntimeInputs,
  options: AdaptiveQueuePreviewOptions,
): AdaptiveQueuePreview {
  if (!options.enabled) {
    return {
      mode: 'legacy',
      schedulerInvoked: false,
      workItems: [],
      executionEvents: [],
      signals: [],
      scheduledWorkItemIds: [],
    };
  }

  const workItems = mapRuntimeInputsToWorkItems(inputs);
  const executionEvents = mapRuntimeInputsToExecutionEvents(inputs);
  const signals = mapRuntimeInputsToQueueSignals(inputs);
  const scheduler = options.scheduler ?? defaultAdaptiveScheduler;
  const scheduledItems = scheduler(workItems, signals).map(cloneWorkItem);
  const maxParallel = Math.max(1, Math.floor(options.maxParallel ?? 1));
  const batch = planRunnableBatch(scheduledItems, maxParallel);

  return {
    mode: 'adaptive-preview',
    schedulerInvoked: true,
    workItems,
    executionEvents,
    signals,
    scheduledWorkItemIds: batch.map(item => item.id),
  };
}

export async function captureAdaptivePreviewJournal(
  preview: AdaptiveQueuePreview,
  options: AdaptivePreviewJournalOptions,
): Promise<EventJournalRecord[]> {
  if (!options.enabled || preview.mode !== 'adaptive-preview') {
    return [];
  }

  const createdAt = (options.now ?? (() => new Date().toISOString()))();
  const source = options.source ?? 'adaptive-preview';
  const records: EventJournalRecord[] = [
    ...preview.executionEvents.map(event =>
      createExecutionEventJournalRecord({
        createdAt,
        source,
        workItemId: event.workItemId,
        event,
      })),
    ...preview.signals.map(signal =>
      createQueueSignalJournalRecord({
        createdAt,
        source,
        workItemId: signal.workItemId,
        signal,
      })),
  ];

  if (records.length === 0) {
    return [];
  }

  const appendRecords = options.appendRecords ?? appendEventJournalRecords;
  return appendRecords(options.journalPath, records, { retentionLimit: options.retentionLimit });
}

export function mapRuntimeInputsToWorkItems(inputs: AdaptiveQueueRuntimeInputs): WorkItem[] {
  const workItems: WorkItem[] = [];

  if (inputs.activeWorkItem) {
    workItems.push(mapActiveWorkItemToWorkItem(inputs.activeWorkItem));
  }

  for (const item of inputs.commandQueue ?? []) {
    const workItem = mapCommandQueueItemToWorkItem(item);
    if (!workItems.some(existing => existing.id === workItem.id)) {
      workItems.push(workItem);
    }
  }

  return workItems;
}

export function mapCommandQueueItemToWorkItem(item: CommandQueueItem): WorkItem {
  return {
    id: commandQueueItemId(item),
    title: item.title,
    kind: 'agent_command',
    status: 'pending',
    priority: item.priority,
    description: item.prompt,
    writePaths: [],
  };
}

export function mapActiveWorkItemToWorkItem(item: ActiveWorkItem): WorkItem {
  return {
    id: activeWorkItemId(item),
    title: item.title,
    kind: 'agent_command',
    status: 'running',
    priority: 'high',
    description: item.issueUrl,
    writePaths: [],
  };
}

export function mapRuntimeInputsToQueueSignals(inputs: AdaptiveQueueRuntimeInputs): QueueSignal[] {
  const signals: QueueSignal[] = [];
  const currentWorkItemId = inputs.activeWorkItem
    ? activeWorkItemId(inputs.activeWorkItem)
    : inputs.commandQueue?.[0]
      ? commandQueueItemId(inputs.commandQueue[0])
      : undefined;

  addGuidanceSignals(signals, inputs.guidance ?? null, currentWorkItemId);
  addResultSignals(signals, inputs.recentResults ?? []);
  for (const signal of inputs.queueSignals ?? []) {
    pushUniqueSignal(signals, cloneQueueSignal(signal));
  }

  return signals;
}

export function mapRuntimeInputsToExecutionEvents(inputs: AdaptiveQueueRuntimeInputs): ExecutionEvent[] {
  return (inputs.executionEvents ?? []).map(cloneExecutionEvent);
}

function defaultAdaptiveScheduler(
  workItems: readonly WorkItem[],
  signals: readonly QueueSignal[],
): readonly WorkItem[] {
  return rebalanceWorkItems(workItems, [], signals);
}

function addGuidanceSignals(
  signals: QueueSignal[],
  guidance: CopilotGuidance | null,
  currentWorkItemId: string | undefined,
): void {
  if (!guidance) return;

  if (guidance.hasCopilotQuestion) {
    pushUniqueSignal(signals, {
      kind: 'agent_question',
      severity: 'warning',
      message: 'Copilot question detected in current guidance.',
      workItemId: currentWorkItemId,
      evidence: trimEvidence(guidance.rawText),
    });
  }

  for (const blocker of guidance.blockers) {
    pushUniqueSignal(signals, {
      kind: 'blocker',
      severity: 'warning',
      message: blocker,
      targetItemId: currentWorkItemId,
      evidence: trimEvidence(blocker),
    });
  }

  for (const error of guidance.errors) {
    pushUniqueSignal(signals, {
      kind: 'blocker',
      severity: 'error',
      message: error,
      targetItemId: currentWorkItemId,
      evidence: trimEvidence(error),
    });
  }

  const validationText = guidance.validation.join('\n');
  for (const signal of classifyExecutionSignals({
    stderr: validationText,
    exitCode: validationText ? 1 : undefined,
    workItemId: currentWorkItemId,
  })) {
    pushUniqueSignal(signals, signal);
  }
}

function addResultSignals(signals: QueueSignal[], results: readonly CopilotResult[]): void {
  for (const result of results) {
    const workItemId = `issue:${result.issueNumber}`;

    if (result.outcome === 'question') {
      pushUniqueSignal(signals, {
        kind: 'agent_question',
        severity: 'warning',
        message: result.summary,
        workItemId,
        evidence: trimEvidence(result.summary),
      });
      continue;
    }

    if (result.outcome === 'blocked') {
      pushUniqueSignal(signals, {
        kind: 'blocker',
        severity: 'warning',
        message: result.summary,
        targetItemId: workItemId,
        evidence: trimEvidence(result.summary),
      });
      continue;
    }

    if (result.outcome === 'error') {
      const classified = classifyExecutionSignals({
        stderr: result.summary,
        exitCode: 1,
        workItemId,
      });

      if (classified.length === 0) {
        pushUniqueSignal(signals, {
          kind: 'blocker',
          severity: 'error',
          message: result.summary,
          targetItemId: workItemId,
          evidence: trimEvidence(result.summary),
        });
        continue;
      }

      for (const signal of classified) {
        pushUniqueSignal(signals, signal);
      }
    }
  }
}

function commandQueueItemId(item: CommandQueueItem): string {
  return item.issueNumber ? `issue:${item.issueNumber}` : `queue:${item.hash}`;
}

function activeWorkItemId(item: ActiveWorkItem): string {
  return `issue:${item.issueNumber}`;
}

function pushUniqueSignal(signals: QueueSignal[], signal: QueueSignal): void {
  const exists = signals.some(existing =>
    existing.kind === signal.kind
    && existing.workItemId === signal.workItemId
    && existing.targetItemId === signal.targetItemId
  );

  if (!exists) signals.push(signal);
}

function trimEvidence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}

function cloneWorkItem(item: WorkItem): WorkItem {
  return {
    ...item,
    dependsOn: item.dependsOn ? [...item.dependsOn] : undefined,
    readPaths: item.readPaths ? [...item.readPaths] : undefined,
    writePaths: item.writePaths ? [...item.writePaths] : undefined,
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
