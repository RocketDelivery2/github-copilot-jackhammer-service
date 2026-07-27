import type { AutomationRunState } from './automation-run.js';
import { createAutomationRunState, markBudgetSpent, registerPlannedPackets } from './automation-run.js';
import { createRawOutputArtifact, normalizeEvidence } from './evidence-normalizer.js';
import { isManualGateActive } from './manual-gate.js';
import type { CodexPort } from './codex-port.js';
import type { CopilotPort } from './copilot-port.js';
import type { PlannerPort } from './planner-port.js';
import { markPacketCompleted, markPacketDispatched, markPacketResultReceived, queueNeedsRefill, refillReadyQueue, selectDispatchablePackets } from './queue-controller.js';
import type { LaneQueuePolicy } from './queue-controller.js';
import type { WorkPacket, PacketExecutionResult } from './work-packet.js';

export type AutomationPorts = {
  planner: PlannerPort;
  codex: CodexPort;
  copilot: CopilotPort;
};

export type AutomationPolicy = {
  codex: LaneQueuePolicy;
  copilot: LaneQueuePolicy;
};

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  codex: { lane: 'codex', targetDepth: 10, lowWatermark: 6, maxConcurrent: 2 },
  copilot: { lane: 'copilot', targetDepth: 1, lowWatermark: 1, maxConcurrent: 1 },
};

export async function initializeAutomationRun(
  input: {
    runId: string;
    repository: string;
    baseBranch: string;
    expectedBaseSha: string;
    objective: string;
    maximumCostUsd?: number;
    maximumDurationMinutes?: number;
    now?: () => string;
  },
  ports: Pick<AutomationPorts, 'planner'>,
  policy: AutomationPolicy = DEFAULT_AUTOMATION_POLICY,
): Promise<AutomationRunState> {
  const now = input.now ?? (() => new Date().toISOString());
  const initial = createAutomationRunState({
    ...input,
    queueTargetDepth: policy.codex.targetDepth,
    queueLowWatermark: policy.codex.lowWatermark,
    codexMaxConcurrency: policy.codex.maxConcurrent,
    copilotMaxConcurrency: policy.copilot.maxConcurrent,
    maximumCostUsd: input.maximumCostUsd,
    maximumDurationMinutes: input.maximumDurationMinutes,
    plannedPackets: [],
    now,
  });

  const planned = await ports.planner.planNextWorkPackets({
    runId: initial.runId,
    repository: initial.repository,
    baseBranch: initial.baseBranch,
    expectedBaseSha: initial.expectedBaseSha,
    objective: initial.objective,
    limit: 100,
    existingWorkItemIds: [],
  });

  let state = registerPlannedPackets(initial, planned, now);
  state = refillQueues(state, policy, now);
  state.status = state.readyQueue.length > 0 ? 'READY' : 'PLANNED';
  return state;
}

export function refillQueues(
  state: AutomationRunState,
  policy: AutomationPolicy = DEFAULT_AUTOMATION_POLICY,
  now: () => string = () => new Date().toISOString(),
): AutomationRunState {
  if (isManualGateActive(state) || state.budget.exhausted) {
    return state;
  }

  let next = state;
  if (queueNeedsRefill(next, policy.codex)) {
    const codexRefill = refillReadyQueue(next, policy.codex, now);
    next = codexRefill.state;
  }

  if (queueNeedsRefill(next, policy.copilot)) {
    const copilotRefill = refillReadyQueue(next, policy.copilot, now);
    next = copilotRefill.state;
  }

  return next;
}

export async function advanceAutomationRun(
  state: AutomationRunState,
  ports: AutomationPorts,
  policy: AutomationPolicy = DEFAULT_AUTOMATION_POLICY,
  now: () => string = () => new Date().toISOString(),
): Promise<AutomationRunState> {
  if (isManualGateActive(state)) {
    return state;
  }

  let next = refillQueues(state, policy, now);
  if (next.budget.exhausted) {
    return next;
  }

  next = await dispatchLane(next, ports.codex, policy.codex, now);
  next = await dispatchLane(next, ports.copilot, policy.copilot, now);

  if (next.completedWorkItemIds.length === Object.keys(next.packets).length && Object.keys(next.packets).length > 0) {
    next.status = 'COMPLETED';
  } else if (next.manualGate) {
    next.status = 'MANUAL_REQUIRED';
  } else if (next.budget.exhausted) {
    next.status = 'BLOCKED';
  } else {
    next.status = next.readyQueue.length > 0 ? 'READY' : 'PLANNED';
  }

  return next;
}

export async function dispatchLane(
  state: AutomationRunState,
  port: CodexPort | CopilotPort,
  policy: LaneQueuePolicy,
  now: () => string = () => new Date().toISOString(),
): Promise<AutomationRunState> {
  if (policy.maxConcurrent <= 0) {
    return state;
  }

  let next = state;
  const dispatchable = selectDispatchablePackets(next, policy);
  for (const workItemId of dispatchable) {
    const packet = next.packets[workItemId]?.packet;
    if (!packet) continue;
    if (next.completedWorkItemIds.includes(workItemId)) continue;
    if (next.budget.exhausted) break;

    next = markPacketDispatched(next, workItemId, now);
    const result = await port.execute({ packet });
    const evidenceId = `${result.runId}:${result.workItemId}:evidence`;
    next = markPacketResultReceived(next, workItemId, evidenceId, now);

    const rawArtifact = createRawOutputArtifact(result.runId, result.workItemId, result.rawOutput, now);
    const evidence = normalizeEvidence({
      ...result,
      rawOutputArtifactId: rawArtifact.artifactId,
    }, now);

    next.artifacts = [...next.artifacts, rawArtifact];
    next.evidence = [...next.evidence, evidence];
    next = markPacketCompleted(next, workItemId, rawArtifact.artifactId, evidence.evidenceId, result.summary, now);
    next = markBudgetSpent(next, packet.maximumCostUsd, packet.maximumDurationMinutes, now);
  }

  return next;
}

export function recordExternalFailure(
  state: AutomationRunState,
  workItemId: string,
  message: string,
  now: () => string = () => new Date().toISOString(),
): AutomationRunState {
  const next = { ...state, packets: { ...state.packets } };
  const runtime = next.packets[workItemId];
  if (!runtime) {
    return next;
  }
  runtime.status = 'FAILED';
  runtime.lastError = message;
  runtime.completedAt = now();
  return next;
}
