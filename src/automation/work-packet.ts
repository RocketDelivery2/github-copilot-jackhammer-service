export type AutomationLane = 'codex' | 'copilot';

export type WorkPacketTaskType =
  | 'architecture'
  | 'missing-tests'
  | 'documentation'
  | 'dependency'
  | 'performance'
  | 'security'
  | 'implementation'
  | 'integration'
  | 'maintenance';

export type AutomationRunStatus =
  | 'PLANNED'
  | 'READY'
  | 'DISPATCHED'
  | 'RUNNING'
  | 'RESULT_RECEIVED'
  | 'VERIFIED'
  | 'COMPLETED'
  | 'RETRY_WAIT'
  | 'BLOCKED'
  | 'MANUAL_REQUIRED'
  | 'FAILED'
  | 'CANCELLED';

export type WorkPacketPriority = 'low' | 'medium' | 'high';

export type ArtifactReference = {
  artifactId: string;
  kind: 'raw-output' | 'evidence' | 'report';
  uri: string;
  checksum: string;
  createdAt: string;
};

export type WorkPacket = {
  workItemId: string;
  runId: string;
  lane: AutomationLane;
  taskType: WorkPacketTaskType;
  repository: string;
  baseBranch: string;
  expectedBaseSha: string;
  authorityCategory: string;
  objective: string;
  allowedPaths: readonly string[];
  forbiddenPaths: readonly string[];
  prohibitedActions: readonly string[];
  dependencies: readonly string[];
  acceptanceCriteria: readonly string[];
  requiredCommands: readonly string[];
  maximumFilesChanged: number;
  maximumLinesChanged: number;
  maximumCostUsd: number;
  maximumDurationMinutes: number;
  manualGateTriggers: readonly string[];
  outputSchemaVersion: number;
  priority?: WorkPacketPriority;
};

export type WorkPacketRuntime = {
  packet: WorkPacket;
  sequence: number;
  status: AutomationRunStatus;
  attempts: number;
  queuedAt: string;
  dispatchedAt?: string;
  completedAt?: string;
  rawOutputArtifactId?: string;
  evidenceId?: string;
  resultSummary?: string;
  lastError?: string;
};

export type EvidenceClassification = 'normalized' | 'verified' | 'blocked';

export type NormalizedEvidence = {
  evidenceId: string;
  runId: string;
  workItemId: string;
  sourceArtifactId: string;
  classification: EvidenceClassification;
  summary: string;
  details: readonly string[];
  createdAt: string;
};

export type PacketExecutionResult = {
  workItemId: string;
  runId: string;
  lane: AutomationLane;
  rawOutput: string;
  rawOutputArtifactId: string;
  summary: string;
  details: readonly string[];
  createdAt: string;
};

export type AutomationEvent =
  | {
      kind: 'run_created';
      runId: string;
      createdAt: string;
      plannedCount: number;
    }
  | {
      kind: 'queue_refilled';
      runId: string;
      createdAt: string;
      added: number;
      readyDepth: number;
    }
  | {
      kind: 'packet_dispatched';
      runId: string;
      workItemId: string;
      lane: AutomationLane;
      createdAt: string;
    }
  | {
      kind: 'packet_result_received';
      runId: string;
      workItemId: string;
      lane: AutomationLane;
      createdAt: string;
    }
  | {
      kind: 'evidence_normalized';
      runId: string;
      workItemId: string;
      evidenceId: string;
      createdAt: string;
    }
  | {
      kind: 'manual_gate_paused';
      runId: string;
      createdAt: string;
      reason: string;
      requiredOwnerAction: string;
    }
  | {
      kind: 'manual_gate_resumed';
      runId: string;
      createdAt: string;
      approvedBy: string;
    }
  | {
      kind: 'budget_exhausted';
      runId: string;
      createdAt: string;
    };

export function priorityRank(priority: WorkPacketPriority | undefined): number {
  switch (priority) {
    case 'high':
      return 2;
    case 'medium':
      return 1;
    default:
      return 0;
  }
}

export function compareWorkPackets(left: WorkPacketRuntime, right: WorkPacketRuntime): number {
  const priorityDelta = priorityRank(right.packet.priority) - priorityRank(left.packet.priority);
  if (priorityDelta !== 0) return priorityDelta;
  const sequenceDelta = left.sequence - right.sequence;
  if (sequenceDelta !== 0) return sequenceDelta;
  return left.packet.workItemId.localeCompare(right.packet.workItemId);
}
