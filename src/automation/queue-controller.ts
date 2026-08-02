import type { AutomationRunState } from './automation-run.js';
import { appendEvent, getReadyPackets, hasCompletedWorkItem } from './automation-run.js';
import { compareWorkPackets, priorityRank } from './work-packet.js';

export type LaneQueuePolicy = {
  lane: 'codex' | 'copilot';
  targetDepth: number;
  lowWatermark: number;
  maxConcurrent: number;
};

export type QueueReconcileResult = {
  state: AutomationRunState;
  added: number;
};

export function refillReadyQueue(
  state: AutomationRunState,
  policy: LaneQueuePolicy,
  now: () => string = () => new Date().toISOString(),
): QueueReconcileResult {
  const next = clone(state);
  const readyDepth = readyQueueDepth(next, policy.lane);
  if (readyDepth >= policy.lowWatermark) {
    return { state: next, added: 0 };
  }

  const availableSlots = Math.max(0, policy.targetDepth - readyDepth);
  if (availableSlots === 0) {
    return { state: next, added: 0 };
  }

  const queued = new Set(next.readyQueue);
  const eligible = next.plannedOrder
    .map(id => next.packets[id])
    .filter(runtime => Boolean(runtime))
    .filter(runtime => runtime.packet.lane === policy.lane)
    .filter(runtime => runtime.status === 'PLANNED')
    .filter(runtime => !queued.has(runtime.packet.workItemId))
    .filter(runtime => runtime.packet.dependencies.every(dep => hasCompletedWorkItem(next, dep)))
    .sort(compareWorkPackets)
    .slice(0, availableSlots);

  if (eligible.length === 0) {
    return { state: next, added: 0 };
  }

  for (const runtime of eligible) {
    runtime.status = 'READY';
    next.readyQueue.push(runtime.packet.workItemId);
  }

  next.events = appendEvent(next, {
    kind: 'queue_refilled',
    runId: next.runId,
    createdAt: now(),
    added: eligible.length,
    readyDepth: next.readyQueue.length,
  }).events;

  return { state: next, added: eligible.length };
}

export function selectDispatchablePackets(
  state: AutomationRunState,
  policy: LaneQueuePolicy,
): string[] {
  const ready = getReadyPackets(state)
    .filter(runtime => runtime.packet.lane === policy.lane)
    .filter(runtime => runtime.status === 'READY')
    .sort(compareWorkPackets);

  return ready.slice(0, policy.maxConcurrent).map(runtime => runtime.packet.workItemId);
}

export function markPacketDispatched(
  state: AutomationRunState,
  workItemId: string,
  now: () => string = () => new Date().toISOString(),
): AutomationRunState {
  const next = clone(state);
  const runtime = next.packets[workItemId];
  if (!runtime) {
    return next;
  }
  runtime.status = 'DISPATCHED';
  runtime.attempts += 1;
  runtime.dispatchedAt = now();
  next.readyQueue = next.readyQueue.filter(id => id !== workItemId);
  next.events.push({
    kind: 'packet_dispatched',
    runId: next.runId,
    workItemId,
    lane: runtime.packet.lane,
    createdAt: runtime.dispatchedAt,
  });
  next.updatedAt = runtime.dispatchedAt;
  return next;
}

export function markPacketResultReceived(
  state: AutomationRunState,
  workItemId: string,
  evidenceId: string,
  now: () => string = () => new Date().toISOString(),
): AutomationRunState {
  const next = clone(state);
  const runtime = next.packets[workItemId];
  if (!runtime) {
    return next;
  }
  runtime.status = 'RESULT_RECEIVED';
  runtime.evidenceId = evidenceId;
  runtime.completedAt = now();
  next.events.push({
    kind: 'packet_result_received',
    runId: next.runId,
    workItemId,
    lane: runtime.packet.lane,
    createdAt: runtime.completedAt,
  });
  next.updatedAt = runtime.completedAt;
  return next;
}

export function markPacketCompleted(
  state: AutomationRunState,
  workItemId: string,
  rawOutputArtifactId: string,
  evidenceId: string,
  summary: string,
  now: () => string = () => new Date().toISOString(),
): AutomationRunState {
  const next = clone(state);
  const runtime = next.packets[workItemId];
  if (!runtime) {
    return next;
  }

  if (next.completedWorkItemIds.includes(workItemId)) {
    return next;
  }

  runtime.status = 'COMPLETED';
  runtime.rawOutputArtifactId = rawOutputArtifactId;
  runtime.evidenceId = evidenceId;
  runtime.resultSummary = summary;
  runtime.completedAt = now();
  next.completedWorkItemIds.push(workItemId);
  next.events.push({
    kind: 'evidence_normalized',
    runId: next.runId,
    workItemId,
    evidenceId,
    createdAt: runtime.completedAt,
  });
  next.updatedAt = runtime.completedAt;
  return next;
}

export function readyQueueDepth(state: AutomationRunState, lane?: 'codex' | 'copilot'): number {
  if (!lane) {
    return state.readyQueue.length;
  }

  return getReadyPackets(state).filter(runtime => runtime.packet.lane === lane).length;
}

export function readyPacketsInStableOrder(state: AutomationRunState): string[] {
  return getReadyPackets(state).map(runtime => runtime.packet.workItemId);
}

export function queueNeedsRefill(state: AutomationRunState, policy: LaneQueuePolicy): boolean {
  return readyQueueDepth(state, policy.lane) < policy.lowWatermark;
}

function clone(state: AutomationRunState): AutomationRunState {
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
    events: state.events.map(event => ({ ...event })),
  };
}

export { priorityRank };
