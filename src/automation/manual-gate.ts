import type { AutomationEvent, AutomationRunStatus } from './work-packet.js';

export type ManualGateState = {
  reason: string;
  requiredOwnerAction: string;
  pausedAt: string;
  approvedBy?: string;
  resumedAt?: string;
};

export type ManualGateResult<T> = {
  state: T;
  event: AutomationEvent;
};

export function enterManualGate<T extends { runId: string; status: AutomationRunStatus; manualGate?: ManualGateState; events: AutomationEvent[] }>(
  state: T,
  reason: string,
  requiredOwnerAction: string,
  now: () => string = () => new Date().toISOString(),
): ManualGateResult<T> {
  const updated = {
    ...state,
    status: 'MANUAL_REQUIRED' as AutomationRunStatus,
    manualGate: {
      reason,
      requiredOwnerAction,
      pausedAt: now(),
    },
    events: [...state.events],
  };

  const event: AutomationEvent = {
    kind: 'manual_gate_paused',
    runId: state.runId,
    createdAt: updated.manualGate.pausedAt,
    reason,
    requiredOwnerAction,
  };

  updated.events.push(event);
  return { state: updated, event };
}

export function resumeManualGate<T extends { runId: string; status: AutomationRunStatus; manualGate?: ManualGateState; events: AutomationEvent[] }>(
  state: T,
  approvedBy: string,
  now: () => string = () => new Date().toISOString(),
): ManualGateResult<T> {
  if (!state.manualGate) {
    return {
      state,
      event: {
        kind: 'manual_gate_resumed',
        runId: state.runId,
        createdAt: now(),
        approvedBy,
      },
    };
  }

  const resumedAt = now();
  const updated = {
    ...state,
    status: 'READY' as AutomationRunStatus,
    manualGate: {
      ...state.manualGate,
      approvedBy,
      resumedAt,
    },
    events: [...state.events],
  };

  const event: AutomationEvent = {
    kind: 'manual_gate_resumed',
    runId: state.runId,
    createdAt: resumedAt,
    approvedBy,
  };

  updated.events.push(event);
  return { state: updated, event };
}

export function isManualGateActive(state: { manualGate?: ManualGateState }): boolean {
  return Boolean(state.manualGate && !state.manualGate.resumedAt);
}
