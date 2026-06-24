import type {
  ApprovalDecisionInput,
  ApprovalDecisionKind,
  ApprovalTransitionResult,
  SkillApprovalCheckpoint,
  SkillApprovalCheckpointTransition,
  SkillApprovalDecision,
  SkillApprovalState,
} from './types.js';

const VALID_DECISION_KINDS = new Set<ApprovalDecisionKind>(['approve', 'reject', 'reset']);

function cloneCheckpoint(checkpoint: SkillApprovalCheckpoint): SkillApprovalCheckpoint {
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

function makeDecision(input: ApprovalDecisionInput): SkillApprovalDecision {
  return {
    checkpointId: input.checkpointId,
    decision: input.decision,
    reason: input.reason,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
  };
}

function makeTransition(
  original: SkillApprovalCheckpoint,
  updated: SkillApprovalCheckpoint,
  decision: SkillApprovalDecision,
  transitionResult: ApprovalTransitionResult,
  transitionReason?: string,
): SkillApprovalCheckpointTransition {
  return {
    originalCheckpoint: cloneCheckpoint(original),
    updatedCheckpoint: cloneCheckpoint(updated),
    decision,
    transitionResult,
    ...(transitionReason !== undefined ? { transitionReason } : {}),
  };
}

export function applyApprovalDecision(
  checkpoint: SkillApprovalCheckpoint,
  input: ApprovalDecisionInput,
): SkillApprovalCheckpointTransition {
  const decision = makeDecision(input);

  if (input.checkpointId !== checkpoint.checkpointId) {
    return makeTransition(
      checkpoint,
      cloneCheckpoint(checkpoint),
      decision,
      'invalid',
      `Checkpoint ID mismatch: expected "${checkpoint.checkpointId}", got "${input.checkpointId}".`,
    );
  }

  if (!VALID_DECISION_KINDS.has(input.decision as ApprovalDecisionKind)) {
    return makeTransition(
      checkpoint,
      cloneCheckpoint(checkpoint),
      decision,
      'invalid',
      `Unknown decision kind: "${input.decision}".`,
    );
  }

  if (input.decision === 'approve' || input.decision === 'reject') {
    if (checkpoint.approvalState === 'not_required') {
      return makeTransition(
        checkpoint,
        cloneCheckpoint(checkpoint),
        decision,
        'ignored',
        'Checkpoint does not require approval.',
      );
    }

    if (checkpoint.approvalState === 'approved' || checkpoint.approvalState === 'rejected') {
      return makeTransition(
        checkpoint,
        cloneCheckpoint(checkpoint),
        decision,
        'ignored',
        'Checkpoint is already resolved; reset before re-deciding.',
      );
    }

    const nextState: SkillApprovalState = input.decision === 'approve' ? 'approved' : 'rejected';
    const updated: SkillApprovalCheckpoint = { ...cloneCheckpoint(checkpoint), approvalState: nextState };
    return makeTransition(checkpoint, updated, decision, 'applied');
  }

  if (checkpoint.approvalState === 'not_required') {
    return makeTransition(
      checkpoint,
      cloneCheckpoint(checkpoint),
      decision,
      'ignored',
      'not_required checkpoints cannot be reset to pending.',
    );
  }

  const updated: SkillApprovalCheckpoint = { ...cloneCheckpoint(checkpoint), approvalState: 'pending' };
  return makeTransition(checkpoint, updated, decision, 'applied');
}

export function applyApprovalDecisions(
  checkpoints: readonly SkillApprovalCheckpoint[],
  inputs: readonly ApprovalDecisionInput[],
): SkillApprovalCheckpointTransition[] {
  const checkpointMap = new Map<string, SkillApprovalCheckpoint>(
    checkpoints.map(cp => [cp.checkpointId, cp]),
  );

  const transitions: SkillApprovalCheckpointTransition[] = [];

  for (const input of inputs) {
    const checkpoint = checkpointMap.get(input.checkpointId);

    if (!checkpoint) {
      const sentinel: SkillApprovalCheckpoint = {
        checkpointId: input.checkpointId,
        taskId: 'unknown',
        skillName: 'unknown',
        resourceType: 'risk_gate',
        reason: 'Unknown checkpoint.',
        risk: 'high',
        approvalState: 'pending',
        createdSource: 'adaptive-preview',
      };
      transitions.push({
        originalCheckpoint: { ...sentinel },
        updatedCheckpoint: { ...sentinel },
        decision: makeDecision(input),
        transitionResult: 'invalid',
        transitionReason: `No checkpoint with ID "${input.checkpointId}" found.`,
      });
      continue;
    }

    const transition = applyApprovalDecision(checkpoint, input);
    transitions.push(transition);

    if (transition.transitionResult === 'applied') {
      checkpointMap.set(input.checkpointId, transition.updatedCheckpoint);
    }
  }

  return transitions;
}
