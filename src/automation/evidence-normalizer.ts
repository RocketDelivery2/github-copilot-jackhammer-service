import { createHash } from 'node:crypto';
import type { ArtifactReference, NormalizedEvidence, PacketExecutionResult } from './work-packet.js';

export type EvidencePromotionRequest = {
  targetClassification: 'verified' | 'blocked';
  approvedBy: string;
  reason: string;
};

export function createRawOutputArtifact(
  runId: string,
  workItemId: string,
  rawOutput: string,
  now: () => string = () => new Date().toISOString(),
): ArtifactReference {
  const checksum = createHash('sha256').update(rawOutput, 'utf8').digest('hex');
  return {
    artifactId: `${runId}:${workItemId}:raw-output`,
    kind: 'raw-output',
    uri: `memory://${encodeURIComponent(runId)}/${encodeURIComponent(workItemId)}/raw-output`,
    checksum,
    createdAt: now(),
  };
}

export function normalizeEvidence(
  result: PacketExecutionResult,
  now: () => string = () => new Date().toISOString(),
): NormalizedEvidence {
  return {
    evidenceId: `${result.runId}:${result.workItemId}:evidence`,
    runId: result.runId,
    workItemId: result.workItemId,
    sourceArtifactId: result.rawOutputArtifactId,
    classification: 'normalized',
    summary: result.summary,
    details: [...result.details],
    createdAt: now(),
  };
}

export function promoteEvidenceClassification(
  evidence: NormalizedEvidence,
  request: EvidencePromotionRequest,
): NormalizedEvidence {
  if (request.targetClassification === evidence.classification) {
    return evidence;
  }

  if (evidence.classification !== 'normalized') {
    throw new Error('Evidence classification can only be promoted from normalized with explicit human approval.');
  }

  if (!request.approvedBy.trim()) {
    throw new Error('Evidence classification promotion requires an approving owner.');
  }

  return {
    ...evidence,
    classification: request.targetClassification,
  };
}

export function isSilentPromotionAllowed(
  evidence: NormalizedEvidence,
  request?: Partial<EvidencePromotionRequest>,
): boolean {
  return Boolean(
    request?.approvedBy?.trim().length &&
    request?.reason?.trim().length &&
    request.targetClassification &&
    request.targetClassification !== evidence.classification,
  );
}
