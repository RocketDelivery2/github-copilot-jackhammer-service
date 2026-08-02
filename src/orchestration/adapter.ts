import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { planRunnableBatch } from './parallelism.js';
import { rebalanceWorkItems } from './rebalance.js';
import { classifyExecutionSignals } from './signals.js';
import {
  commandResultToExecutionEvents,
  commandResultToQueueSignals,
  executeCommandCapture,
} from './command-runner.js';
import {
  appendEventJournalRecords,
  createExecutionEventJournalRecord,
  createSkillApprovalCheckpointJournalRecord,
  createSkillApprovalDecisionJournalRecord,
  createSkillExecutionPlanJournalRecord,
  createQueueSignalJournalRecord,
  createSkillSelectionJournalRecord,
  createAgentDelegationJournalRecord,
} from './event-journal.js';
import type { ActiveWorkItem, CommandQueueItem, CopilotGuidance, CopilotResult } from '../types.js';
import type { CommandExecutionRequest, CommandExecutionResult } from './command-runner.js';
import type { EventJournalRecord } from './event-journal.js';
import type { AgentDelegationMessage } from '../agents/types.js';
import type { ExecutionEvent, QueueSignal, WorkItem } from './types.js';
import { buildSkillApprovalCheckpoints } from '../skills/approval-checkpoint.js';
import { applyApprovalDecisions } from '../skills/approval-decision.js';
import { parseDecisionInputs } from '../skills/decision-input-source.js';
import { applyPersistedApprovalState, loadApprovalStatePersistence } from '../skills/approval-state-persistence.js';
import type { ApprovalStatePersistenceRecord } from '../skills/approval-state-persistence.js';
import { buildSkillExecutionPlan } from '../skills/execution-plan.js';
import { loadSkillDocumentFromFile } from '../skills/loader.js';
import { selectSkillsForTask } from '../skills/selector.js';
import { evaluateSkillResourcePolicy } from '../skills/trust-policy.js';
import type {
  ApprovalDecisionInput,
  SkillApprovalCheckpoint,
  SkillApprovalCheckpointTransition,
  SkillDocument,
  SkillExecutionPlan,
  SkillMetadataIndex,
  SkillTaskLike,
} from '../skills/types.js';

export type AdaptiveQueueRuntimeInputs = {
  activeWorkItem?: ActiveWorkItem;
  commandQueue?: readonly CommandQueueItem[];
  guidance?: CopilotGuidance | null;
  recentResults?: readonly CopilotResult[];
  executionEvents?: readonly ExecutionEvent[];
  queueSignals?: readonly QueueSignal[];
  agentDelegations?: readonly AgentDelegationMessage[];
  skillSelections?: readonly AdaptivePreviewSkillSelection[];
  skillExecutionPlans?: readonly SkillExecutionPlan[];
  skillApprovalCheckpoints?: readonly SkillApprovalCheckpoint[];
  skillApprovalDecisionInputs?: readonly ApprovalDecisionInput[];
  approvalStatePersistence?: ApprovalStatePersistenceRecord;
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
  agentDelegations: AgentDelegationMessage[];
  skillSelections: AdaptivePreviewSkillSelection[];
  skillExecutionPlans: SkillExecutionPlan[];
  skillApprovalCheckpoints: SkillApprovalCheckpoint[];
  skillApprovalDecisions: SkillApprovalCheckpointTransition[];
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

export type AdaptivePreviewCaptureSource = 'none' | 'recent-results' | 'validation-probes';

export type AdaptivePreviewValidationProbe = {
  command: string;
  args?: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  workItemId?: string;
};

export type BuildAdaptivePreviewCaptureRequestsOptions = {
  enabled: boolean;
  source: AdaptivePreviewCaptureSource;
  limit: number;
  recentResults?: readonly CopilotResult[];
  validationProbes?: readonly AdaptivePreviewValidationProbe[];
  defaultCwd?: string;
  nodeExecutable?: string;
};

export type AdaptivePreviewCommandCaptureOptions = {
  enabled: boolean;
  requests: readonly CommandExecutionRequest[];
  captureLimit?: number;
  executeCapture?: (request: CommandExecutionRequest) => Promise<CommandExecutionResult>;
  resultToExecutionEvents?: (result: CommandExecutionResult) => ExecutionEvent[];
  resultToQueueSignals?: (result: CommandExecutionResult) => QueueSignal[];
};

export type AdaptivePreviewCommandCapture = {
  commandResults: CommandExecutionResult[];
  executionEvents: ExecutionEvent[];
  queueSignals: QueueSignal[];
};

export type AdaptivePreviewSkillTask = SkillTaskLike & {
  id: string;
};

export type AdaptivePreviewSkillSelection = {
  taskId: string;
  skillName: string;
  rank: number;
  score: number;
  reasons: string[];
  risk: 'low' | 'medium' | 'high';
  allowedTools: string[];
  trustPolicySummary: {
    instructionsReadAllowed: boolean;
    referencesReadAllowed: boolean;
    assetsReadAllowed: boolean;
    scriptsRequireHumanApproval: boolean;
    scriptsAutoExecutable: boolean;
  };
};

export type AdaptivePreviewSkillSelectionOptions = {
  enabled: boolean;
  skillIndex: SkillMetadataIndex;
  tasks: readonly AdaptivePreviewSkillTask[];
  maxSelections?: number;
  maxMatchesPerTask?: number;
};

export type AdaptivePreviewSkillExecutionPlanOptions = {
  enabled: boolean;
  skillSelections: readonly AdaptivePreviewSkillSelection[];
  skillIndex: SkillMetadataIndex;
  maxPlans?: number;
  maxStepsPerPlan?: number;
  loadSkillDocument?: (filePath: string) => Promise<SkillDocument>;
};

export type AdaptivePreviewSkillApprovalCheckpointOptions = {
  enabled: boolean;
  skillExecutionPlans: readonly SkillExecutionPlan[];
  maxCheckpoints?: number;
};

export type AdaptivePreviewApprovalDecisionOptions = {
  enabled: boolean;
  checkpoints: readonly SkillApprovalCheckpoint[];
  decisionInputs: readonly ApprovalDecisionInput[];
  maxDecisions?: number;
};

export type AdaptivePreviewDecisionInputSourceOptions = {
  enabled: boolean;
  filePath?: string;
  loadFile?: (path: string) => Promise<string>;
};

export type AdaptivePreviewApprovalStatePersistenceOptions = {
  enabled: boolean;
  filePath?: string;
  loadState?: (path: string) => Promise<ApprovalStatePersistenceRecord>;
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
      agentDelegations: [],
      skillSelections: [],
      skillExecutionPlans: [],
      skillApprovalCheckpoints: [],
      skillApprovalDecisions: [],
      scheduledWorkItemIds: [],
    };
  }

  const workItems = mapRuntimeInputsToWorkItems(inputs);
  const executionEvents = mapRuntimeInputsToExecutionEvents(inputs);
  const signals = mapRuntimeInputsToQueueSignals(inputs);
  const agentDelegations = mapRuntimeInputsToAgentDelegations(inputs);
  const skillSelections = mapRuntimeInputsToSkillSelections(inputs);
  const skillExecutionPlans = mapRuntimeInputsToSkillExecutionPlans(inputs);
  const baseSkillApprovalCheckpoints = mapRuntimeInputsToSkillApprovalCheckpoints(inputs);
  const skillApprovalCheckpoints = inputs.approvalStatePersistence
    ? applyPersistedApprovalState(baseSkillApprovalCheckpoints, inputs.approvalStatePersistence)
    : baseSkillApprovalCheckpoints;
  const skillApprovalDecisions = mapRuntimeInputsToSkillApprovalDecisions(inputs, skillApprovalCheckpoints);
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
    agentDelegations,
    skillSelections,
    skillExecutionPlans,
    skillApprovalCheckpoints,
    skillApprovalDecisions,
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
    ...preview.agentDelegations.map(delegation =>
      createAgentDelegationJournalRecord({
        createdAt,
        source,
        workItemId: delegation.id,
        delegation,
      })),
    ...preview.skillSelections.map(selection =>
      createSkillSelectionJournalRecord({
        createdAt,
        source,
        workItemId: selection.taskId,
        selection: {
          taskId: selection.taskId,
          skillName: selection.skillName,
          rank: selection.rank,
          score: selection.score,
          reasons: [...selection.reasons],
          risk: selection.risk,
          allowedTools: [...selection.allowedTools],
          trustPolicySummary: {
            instructionsReadAllowed: selection.trustPolicySummary.instructionsReadAllowed,
            referencesReadAllowed: selection.trustPolicySummary.referencesReadAllowed,
            assetsReadAllowed: selection.trustPolicySummary.assetsReadAllowed,
            scriptsRequireHumanApproval: selection.trustPolicySummary.scriptsRequireHumanApproval,
            scriptsAutoExecutable: selection.trustPolicySummary.scriptsAutoExecutable,
          },
        },
      })),
    ...preview.skillExecutionPlans.map(plan =>
      createSkillExecutionPlanJournalRecord({
        createdAt,
        source,
        workItemId: plan.taskId,
        plan: {
          taskId: plan.taskId,
          skillName: plan.skillName,
          selectionRank: plan.selectionRank,
          selectionScore: plan.selectionScore,
          selectionReasons: [...plan.selectionReasons],
          risk: plan.risk,
          allowedTools: [...plan.allowedTools],
          plannedSteps: plan.plannedSteps.map(step => ({ index: step.index, summary: step.summary })),
          trustPolicySummary: {
            instructionsReadAllowed: plan.trustPolicySummary.instructionsReadAllowed,
            referencesReadAllowed: plan.trustPolicySummary.referencesReadAllowed,
            assetsReadAllowed: plan.trustPolicySummary.assetsReadAllowed,
            scriptsRequireHumanApproval: plan.trustPolicySummary.scriptsRequireHumanApproval,
            scriptsAutoExecutable: plan.trustPolicySummary.scriptsAutoExecutable,
            scriptExecutionBlocked: plan.trustPolicySummary.scriptExecutionBlocked,
          },
        },
      })),
    ...preview.skillApprovalCheckpoints.map(checkpoint =>
      createSkillApprovalCheckpointJournalRecord({
        createdAt,
        source,
        workItemId: checkpoint.taskId,
        checkpoint: {
          checkpointId: checkpoint.checkpointId,
          taskId: checkpoint.taskId,
          skillName: checkpoint.skillName,
          resourceType: checkpoint.resourceType,
          reason: checkpoint.reason,
          risk: checkpoint.risk,
          approvalState: checkpoint.approvalState,
          createdSource: checkpoint.createdSource,
        },
      })),
    ...preview.skillApprovalDecisions.map(transition =>
      createSkillApprovalDecisionJournalRecord({
        createdAt,
        source,
        workItemId: transition.updatedCheckpoint.taskId,
        decision: {
          checkpointId: transition.decision.checkpointId,
          skillName: transition.updatedCheckpoint.skillName,
          resourceType: transition.updatedCheckpoint.resourceType,
          decision: transition.decision.decision,
          reason: transition.decision.reason,
          decidedBy: transition.decision.decidedBy,
          decidedAt: transition.decision.decidedAt,
          transitionResult: transition.transitionResult,
          ...(transition.transitionReason !== undefined
            ? { transitionReason: transition.transitionReason }
            : {}),
          updatedApprovalState: transition.updatedCheckpoint.approvalState,
        },
      })),
  ];

  if (records.length === 0) {
    return [];
  }

  const appendRecords = options.appendRecords ?? appendEventJournalRecords;
  return appendRecords(options.journalPath, records, { retentionLimit: options.retentionLimit });
}

export function buildAdaptivePreviewCommandCaptureRequests(
  options: BuildAdaptivePreviewCaptureRequestsOptions,
): CommandExecutionRequest[] {
  if (!options.enabled) {
    return [];
  }

  const limit = normalizeCaptureLimit(options.limit);
  if (limit === 0) {
    return [];
  }

  if (options.source === 'none') {
    return [];
  }

  if (options.source === 'recent-results') {
    const nodeExecutable = options.nodeExecutable ?? process.execPath;
    const cwd = options.defaultCwd ?? process.cwd();
    return (options.recentResults ?? []).slice(0, limit).map(result => ({
      command: nodeExecutable,
      args: ['-e', previewCaptureScriptForResult(result)],
      cwd,
      timeoutMs: 2_000,
      workItemId: `issue:${result.issueNumber}`,
    }));
  }

  return (options.validationProbes ?? []).slice(0, limit).map(probe => ({
    command: probe.command,
    args: probe.args ? [...probe.args] : undefined,
    cwd: probe.cwd ?? options.defaultCwd,
    timeoutMs: probe.timeoutMs,
    workItemId: probe.workItemId,
  }));
}

export async function captureAdaptivePreviewCommandRunnerFeedback(
  options: AdaptivePreviewCommandCaptureOptions,
): Promise<AdaptivePreviewCommandCapture> {
  const limit = normalizeCaptureLimit(options.captureLimit ?? options.requests.length);
  const boundedRequests = options.requests.slice(0, limit);

  if (!options.enabled || boundedRequests.length === 0) {
    return {
      commandResults: [],
      executionEvents: [],
      queueSignals: [],
    };
  }

  const executeCapture = options.executeCapture ?? executeCommandCapture;
  const resultToExecutionEvents = options.resultToExecutionEvents ?? commandResultToExecutionEvents;
  const resultToQueueSignals = options.resultToQueueSignals ?? commandResultToQueueSignals;

  const commandResults: CommandExecutionResult[] = [];
  const executionEvents: ExecutionEvent[] = [];
  const queueSignals: QueueSignal[] = [];

  for (const request of boundedRequests) {
    const result = await executeCapture(cloneCommandExecutionRequest(request));
    commandResults.push(cloneCommandExecutionResult(result));

    for (const event of resultToExecutionEvents(result)) {
      executionEvents.push(cloneExecutionEvent(event));
    }

    for (const signal of resultToQueueSignals(result)) {
      pushUniqueSignal(queueSignals, cloneQueueSignal(signal));
    }
  }

  return {
    commandResults,
    executionEvents,
    queueSignals,
  };
}

export function selectAdaptivePreviewSkills(
  options: AdaptivePreviewSkillSelectionOptions,
): AdaptivePreviewSkillSelection[] {
  if (!options.enabled) {
    return [];
  }

  const maxSelections = Math.max(0, Math.floor(options.maxSelections ?? 16));
  const maxMatchesPerTask = Math.max(1, Math.floor(options.maxMatchesPerTask ?? 1));
  if (maxSelections === 0) {
    return [];
  }

  const selected: AdaptivePreviewSkillSelection[] = [];
  for (const task of options.tasks) {
    const matches = selectSkillsForTask(options.skillIndex, task, { limit: maxMatchesPerTask });
    for (const match of matches) {
      const basePath = normalizeSkillBasePath(match.skill.skillPath, match.skill.name);
      const instructionsPolicy = evaluateSkillResourcePolicy(`${basePath}/skill.md`);
      const referencesPolicy = evaluateSkillResourcePolicy(`${basePath}/references/reference.md`);
      const assetsPolicy = evaluateSkillResourcePolicy(`${basePath}/assets/asset.txt`);
      const scriptsPolicy = evaluateSkillResourcePolicy(`${basePath}/scripts/example.ps1`);

      selected.push({
        taskId: task.id,
        skillName: match.skill.name,
        rank: 0,
        score: match.score,
        reasons: [...match.reasons],
        risk: match.skill.risk,
        allowedTools: [...match.skill.allowedTools],
        trustPolicySummary: {
          instructionsReadAllowed: instructionsPolicy.readAllowed,
          referencesReadAllowed: referencesPolicy.readAllowed,
          assetsReadAllowed: assetsPolicy.readAllowed,
          scriptsRequireHumanApproval: scriptsPolicy.requiresHumanApproval,
          scriptsAutoExecutable: scriptsPolicy.autoExecutable,
        },
      });
    }
  }

  selected.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.taskId !== right.taskId) {
      return left.taskId.localeCompare(right.taskId);
    }
    return left.skillName.localeCompare(right.skillName);
  });

  return selected.slice(0, maxSelections).map((selection, index) => ({
    ...selection,
    rank: index + 1,
  }));
}

export async function buildAdaptivePreviewSkillExecutionPlans(
  options: AdaptivePreviewSkillExecutionPlanOptions,
): Promise<SkillExecutionPlan[]> {
  if (!options.enabled) {
    return [];
  }

  const maxPlans = Math.max(0, Math.floor(options.maxPlans ?? 8));
  const maxStepsPerPlan = Math.max(1, Math.floor(options.maxStepsPerPlan ?? 6));
  if (maxPlans === 0) {
    return [];
  }

  const loadDocument = options.loadSkillDocument ?? loadSkillDocumentFromFile;
  const plans: SkillExecutionPlan[] = [];
  for (const selection of options.skillSelections.slice(0, maxPlans)) {
    const metadata = options.skillIndex.skills.find(skill => skill.name === selection.skillName);
    if (!metadata?.skillPath) {
      continue;
    }

    const document = await loadDocument(metadata.skillPath);
    plans.push(buildSkillExecutionPlan({
      taskId: selection.taskId,
      skillName: selection.skillName,
      selectionRank: selection.rank,
      selectionScore: selection.score,
      selectionReasons: selection.reasons,
      risk: selection.risk,
      allowedTools: selection.allowedTools,
      document,
      maxSteps: maxStepsPerPlan,
      trustPolicySummary: {
        instructionsReadAllowed: selection.trustPolicySummary.instructionsReadAllowed,
        referencesReadAllowed: selection.trustPolicySummary.referencesReadAllowed,
        assetsReadAllowed: selection.trustPolicySummary.assetsReadAllowed,
        scriptsRequireHumanApproval: selection.trustPolicySummary.scriptsRequireHumanApproval,
        scriptsAutoExecutable: selection.trustPolicySummary.scriptsAutoExecutable,
        scriptExecutionBlocked: true,
      },
    }));
  }

  return plans;
}

export function buildAdaptivePreviewSkillApprovalCheckpoints(
  options: AdaptivePreviewSkillApprovalCheckpointOptions,
): SkillApprovalCheckpoint[] {
  if (!options.enabled) {
    return [];
  }

  return buildSkillApprovalCheckpoints({
    plans: options.skillExecutionPlans,
    maxCheckpoints: options.maxCheckpoints ?? 16,
  });
}

export async function loadAdaptivePreviewApprovalStatePersistence(
  options: AdaptivePreviewApprovalStatePersistenceOptions,
): Promise<ApprovalStatePersistenceRecord | undefined> {
  if (!options.enabled || !options.filePath || options.filePath.trim().length === 0) {
    return undefined;
  }

  const loadState = options.loadState ?? loadApprovalStatePersistence;
  return loadState(options.filePath);
}

export function buildAdaptivePreviewSkillApprovalDecisions(
  options: AdaptivePreviewApprovalDecisionOptions,
): SkillApprovalCheckpointTransition[] {
  if (!options.enabled) {
    return [];
  }

  if (options.decisionInputs.length === 0) {
    return [];
  }

  const maxDecisions = Math.max(0, Math.floor(options.maxDecisions ?? 64));
  const transitions = applyApprovalDecisions(options.checkpoints, options.decisionInputs);
  return transitions.slice(0, maxDecisions);
}

export async function loadAdaptivePreviewDecisionInputs(
  options: AdaptivePreviewDecisionInputSourceOptions,
): Promise<ApprovalDecisionInput[]> {
  if (!options.enabled || !options.filePath || options.filePath.trim().length === 0) {
    return [];
  }

  const load = options.loadFile ?? ((fp: string) => readFile(fp, 'utf8'));

  let contents: string;
  try {
    contents = await load(options.filePath);
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(
      `Malformed adaptive preview decision inputs file "${options.filePath}": invalid JSON.`,
    );
  }

  const result = parseDecisionInputs(parsed);
  return result.inputs;
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

export function mapRuntimeInputsToAgentDelegations(inputs: AdaptiveQueueRuntimeInputs): AgentDelegationMessage[] {
  return [...(inputs.agentDelegations ?? [])]
    .map(cloneAgentDelegationMessage)
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
      || left.fromAgentId.localeCompare(right.fromAgentId)
      || left.toAgentId.localeCompare(right.toAgentId)
      || left.topic.localeCompare(right.topic));
}

function cloneAgentDelegationMessage(message: AgentDelegationMessage): AgentDelegationMessage {
  return {
    id: message.id,
    fromAgentId: message.fromAgentId,
    toAgentId: message.toAgentId,
    topic: message.topic,
    payload: { ...message.payload },
    requiredCapabilities: [...message.requiredCapabilities],
    priority: message.priority,
    createdAt: message.createdAt,
  };
}

export function mapRuntimeInputsToSkillSelections(inputs: AdaptiveQueueRuntimeInputs): AdaptivePreviewSkillSelection[] {
  return (inputs.skillSelections ?? []).map(cloneSkillSelection);
}

export function mapRuntimeInputsToSkillExecutionPlans(inputs: AdaptiveQueueRuntimeInputs): SkillExecutionPlan[] {
  return (inputs.skillExecutionPlans ?? []).map(cloneSkillExecutionPlan);
}

export function mapRuntimeInputsToSkillApprovalCheckpoints(inputs: AdaptiveQueueRuntimeInputs): SkillApprovalCheckpoint[] {
  return (inputs.skillApprovalCheckpoints ?? []).map(cloneSkillApprovalCheckpoint);
}

export function mapRuntimeInputsToSkillApprovalDecisions(
  inputs: AdaptiveQueueRuntimeInputs,
  checkpoints: readonly SkillApprovalCheckpoint[],
): SkillApprovalCheckpointTransition[] {
  const decisionInputs = inputs.skillApprovalDecisionInputs ?? [];
  if (decisionInputs.length === 0) {
    return [];
  }
  return applyApprovalDecisions(checkpoints, decisionInputs);
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

function previewCaptureScriptForResult(result: CopilotResult): string {
  const summary = JSON.stringify(result.summary || result.title || 'No summary provided.');
  if (result.outcome === 'error' || result.outcome === 'blocked') {
    return `process.stderr.write(${summary}); process.exit(1);`;
  }

  if (result.outcome === 'question') {
    return `process.stderr.write(${summary});`;
  }

  return `process.stdout.write(${summary});`;
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

function normalizeCaptureLimit(limit: number): number {
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 0) {
    throw new RangeError('captureLimit must be a non-negative integer.');
  }

  return limit;
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

function cloneCommandExecutionRequest(request: CommandExecutionRequest): CommandExecutionRequest {
  return {
    command: request.command,
    args: request.args ? [...request.args] : undefined,
    cwd: request.cwd,
    env: request.env ? { ...request.env } : undefined,
    timeoutMs: request.timeoutMs,
    workItemId: request.workItemId,
  };
}

function cloneCommandExecutionResult(result: CommandExecutionResult): CommandExecutionResult {
  return {
    command: result.command,
    executable: result.executable,
    args: [...result.args],
    cwd: result.cwd,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    timeoutMs: result.timeoutMs,
    workItemId: result.workItemId,
  };
}

function cloneSkillSelection(selection: AdaptivePreviewSkillSelection): AdaptivePreviewSkillSelection {
  return {
    taskId: selection.taskId,
    skillName: selection.skillName,
    rank: selection.rank,
    score: selection.score,
    reasons: [...selection.reasons],
    risk: selection.risk,
    allowedTools: [...selection.allowedTools],
    trustPolicySummary: {
      instructionsReadAllowed: selection.trustPolicySummary.instructionsReadAllowed,
      referencesReadAllowed: selection.trustPolicySummary.referencesReadAllowed,
      assetsReadAllowed: selection.trustPolicySummary.assetsReadAllowed,
      scriptsRequireHumanApproval: selection.trustPolicySummary.scriptsRequireHumanApproval,
      scriptsAutoExecutable: selection.trustPolicySummary.scriptsAutoExecutable,
    },
  };
}

function cloneSkillExecutionPlan(plan: SkillExecutionPlan): SkillExecutionPlan {
  return {
    taskId: plan.taskId,
    skillName: plan.skillName,
    selectionRank: plan.selectionRank,
    selectionScore: plan.selectionScore,
    selectionReasons: [...plan.selectionReasons],
    risk: plan.risk,
    allowedTools: [...plan.allowedTools],
    plannedSteps: plan.plannedSteps.map(step => ({ index: step.index, summary: step.summary })),
    trustPolicySummary: {
      instructionsReadAllowed: plan.trustPolicySummary.instructionsReadAllowed,
      referencesReadAllowed: plan.trustPolicySummary.referencesReadAllowed,
      assetsReadAllowed: plan.trustPolicySummary.assetsReadAllowed,
      scriptsRequireHumanApproval: plan.trustPolicySummary.scriptsRequireHumanApproval,
      scriptsAutoExecutable: plan.trustPolicySummary.scriptsAutoExecutable,
      scriptExecutionBlocked: plan.trustPolicySummary.scriptExecutionBlocked,
    },
  };
}

function cloneSkillApprovalCheckpoint(checkpoint: SkillApprovalCheckpoint): SkillApprovalCheckpoint {
  return {
    checkpointId: checkpoint.checkpointId,
    taskId: checkpoint.taskId,
    skillName: checkpoint.skillName,
    resourceType: checkpoint.resourceType,
    reason: checkpoint.reason,
    risk: checkpoint.risk,
    approvalState: checkpoint.approvalState,
    createdSource: checkpoint.createdSource,
  };
}

function cloneSkillApprovalCheckpointTransition(
  transition: SkillApprovalCheckpointTransition,
): SkillApprovalCheckpointTransition {
  return {
    originalCheckpoint: cloneSkillApprovalCheckpoint(transition.originalCheckpoint),
    updatedCheckpoint: cloneSkillApprovalCheckpoint(transition.updatedCheckpoint),
    decision: {
      checkpointId: transition.decision.checkpointId,
      decision: transition.decision.decision,
      reason: transition.decision.reason,
      decidedBy: transition.decision.decidedBy,
      decidedAt: transition.decision.decidedAt,
    },
    transitionResult: transition.transitionResult,
    ...(transition.transitionReason !== undefined ? { transitionReason: transition.transitionReason } : {}),
  };
}

function normalizeSkillBasePath(skillPath: string | undefined, skillName: string): string {
  if (!skillPath || skillPath.trim().length === 0) {
    return `skills/${skillName}`;
  }

  const normalized = skillPath.replace(/\\/g, '/');
  const suffix = '/skill.md';
  if (normalized.toLowerCase().endsWith(suffix)) {
    return normalized.slice(0, -suffix.length);
  }
  return normalized;
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
