import type { ArtifactReference, AutomationEvent, AutomationRunStatus, NormalizedEvidence, WorkPacket, WorkPacketRuntime } from './work-packet.js';
import { compareWorkPackets } from './work-packet.js';
import type { ManualGateState } from './manual-gate.js';

export type AutomationBudget = {
  maximumCostUsd: number;
  maximumDurationMinutes: number;
  spentCostUsd: number;
  elapsedMinutes: number;
  exhausted: boolean;
};

export type AutomationRunState = {
  version: 1;
  runId: string;
  repository: string;
  baseBranch: string;
  expectedBaseSha: string;
  objective: string;
  status: AutomationRunStatus;
  queueTargetDepth: number;
  queueLowWatermark: number;
  codexMaxConcurrency: number;
  copilotMaxConcurrency: number;
  budget: AutomationBudget;
  manualGate?: ManualGateState;
  packets: Record<string, WorkPacketRuntime>;
  plannedOrder: string[];
  readyQueue: string[];
  completedWorkItemIds: string[];
  evidence: NormalizedEvidence[];
  artifacts: ArtifactReference[];
  events: AutomationEvent[];
  createdAt: string;
  updatedAt: string;
};

export type CreateAutomationRunInput = {
  runId: string;
  repository: string;
  baseBranch: string;
  expectedBaseSha: string;
  objective: string;
  queueTargetDepth?: number;
  queueLowWatermark?: number;
  codexMaxConcurrency?: number;
  copilotMaxConcurrency?: number;
  maximumCostUsd?: number;
  maximumDurationMinutes?: number;
  plannedPackets?: readonly WorkPacket[];
  now?: () => string;
};

export function createAutomationRunState(input: CreateAutomationRunInput): AutomationRunState {
  const now = input.now ?? (() => new Date().toISOString());
  const createdAt = now();
  let state: AutomationRunState = {
    version: 1,
    runId: input.runId,
    repository: input.repository,
    baseBranch: input.baseBranch,
    expectedBaseSha: input.expectedBaseSha,
    objective: input.objective,
    status: 'PLANNED',
    queueTargetDepth: input.queueTargetDepth ?? 10,
    queueLowWatermark: input.queueLowWatermark ?? 6,
    codexMaxConcurrency: input.codexMaxConcurrency ?? 2,
    copilotMaxConcurrency: input.copilotMaxConcurrency ?? 1,
    budget: {
      maximumCostUsd: input.maximumCostUsd ?? 100,
      maximumDurationMinutes: input.maximumDurationMinutes ?? 120,
      spentCostUsd: 0,
      elapsedMinutes: 0,
      exhausted: false,
    },
    packets: {},
    plannedOrder: [],
    readyQueue: [],
    completedWorkItemIds: [],
    evidence: [],
    artifacts: [],
    events: [],
    createdAt,
    updatedAt: createdAt,
  };

  if (input.plannedPackets && input.plannedPackets.length > 0) {
    state = registerPlannedPackets(state, input.plannedPackets, now);
  }

  state.events.push({
    kind: 'run_created',
    runId: state.runId,
    createdAt,
    plannedCount: state.plannedOrder.length,
  });

  return state;
}

export function registerPlannedPackets(
  state: AutomationRunState,
  packets: readonly WorkPacket[],
  now: () => string = () => new Date().toISOString(),
): AutomationRunState {
  const next = cloneAutomationRunState(state);
  for (const packet of packets) {
    if (next.packets[packet.workItemId]) {
      continue;
    }
    const queuedAt = now();
    next.packets[packet.workItemId] = {
      packet,
      sequence: next.plannedOrder.length,
      status: 'PLANNED',
      attempts: 0,
      queuedAt,
    };
    next.plannedOrder.push(packet.workItemId);
  }
  next.updatedAt = now();
  return next;
}

export function cloneAutomationRunState(state: AutomationRunState): AutomationRunState {
  return {
    ...state,
    budget: { ...state.budget },
    manualGate: state.manualGate ? { ...state.manualGate } : undefined,
    packets: Object.fromEntries(
      Object.entries(state.packets).map(([id, runtime]) => [
        id,
        {
          ...runtime,
          packet: {
            ...runtime.packet,
            allowedPaths: [...runtime.packet.allowedPaths],
            forbiddenPaths: [...runtime.packet.forbiddenPaths],
            prohibitedActions: [...runtime.packet.prohibitedActions],
            dependencies: [...runtime.packet.dependencies],
            acceptanceCriteria: [...runtime.packet.acceptanceCriteria],
            requiredCommands: [...runtime.packet.requiredCommands],
            manualGateTriggers: [...runtime.packet.manualGateTriggers],
          },
        },
      ]),
    ),
    plannedOrder: [...state.plannedOrder],
    readyQueue: [...state.readyQueue],
    completedWorkItemIds: [...state.completedWorkItemIds],
    evidence: state.evidence.map(item => ({ ...item, details: [...item.details] })),
    artifacts: state.artifacts.map(item => ({ ...item })),
    events: state.events.map(event => ({ ...event } as AutomationEvent)),
  };
}

export function appendEvent(state: AutomationRunState, event: AutomationEvent): AutomationRunState {
  const next = cloneAutomationRunState(state);
  next.events.push(event);
  next.updatedAt = event.createdAt;
  return next;
}

export function getReadyPackets(state: AutomationRunState): WorkPacketRuntime[] {
  return state.readyQueue
    .map(id => state.packets[id])
    .filter((packet): packet is WorkPacketRuntime => Boolean(packet))
    .sort(compareWorkPackets);
}

export function hasCompletedWorkItem(state: AutomationRunState, workItemId: string): boolean {
  return state.completedWorkItemIds.includes(workItemId);
}

export function isRunBudgetExhausted(state: AutomationRunState): boolean {
  return state.budget.exhausted || state.budget.spentCostUsd >= state.budget.maximumCostUsd || state.budget.elapsedMinutes >= state.budget.maximumDurationMinutes;
}

export function markBudgetSpent(
  state: AutomationRunState,
  costUsd: number,
  durationMinutes: number,
  now: () => string = () => new Date().toISOString(),
): AutomationRunState {
  const next = cloneAutomationRunState(state);
  next.budget.spentCostUsd += costUsd;
  next.budget.elapsedMinutes += durationMinutes;
  next.budget.exhausted = isRunBudgetExhausted(next);
  next.updatedAt = now();
  return next;
}
