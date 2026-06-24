import type { ApprovalDecisionInput, ApprovalDecisionKind } from './types.js';

const VALID_DECISION_KINDS = new Set<ApprovalDecisionKind>(['approve', 'reject', 'reset']);

export type ParsedDecisionInputItem =
  | { valid: true; input: ApprovalDecisionInput }
  | { valid: false; raw: unknown; reason: string };

export type DecisionInputSourceResult = {
  inputs: ApprovalDecisionInput[];
  invalid: Array<{ raw: unknown; reason: string }>;
};

export function parseDecisionInputs(raw: unknown): DecisionInputSourceResult {
  if (!Array.isArray(raw)) {
    throw new Error('Decision inputs must be a JSON array.');
  }

  const inputs: ApprovalDecisionInput[] = [];
  const invalid: Array<{ raw: unknown; reason: string }> = [];

  for (const entry of raw) {
    const parsed = parseDecisionInputItem(entry);
    if (parsed.valid) {
      inputs.push(parsed.input);
    } else {
      invalid.push({ raw: parsed.raw, reason: parsed.reason });
    }
  }

  return { inputs, invalid };
}

function parseDecisionInputItem(raw: unknown): ParsedDecisionInputItem {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, raw, reason: 'Each decision input entry must be a non-null object.' };
  }

  const entry = raw as Record<string, unknown>;

  const checkpointId = entry.checkpointId;
  if (typeof checkpointId !== 'string' || checkpointId.trim().length === 0) {
    return { valid: false, raw, reason: 'checkpointId must be a non-empty string.' };
  }

  const decision = entry.decision;
  if (!VALID_DECISION_KINDS.has(decision as ApprovalDecisionKind)) {
    return {
      valid: false,
      raw,
      reason: `decision must be one of: approve, reject, reset; got "${String(decision)}".`,
    };
  }

  const reason = entry.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { valid: false, raw, reason: 'reason must be a non-empty string.' };
  }

  const decidedBy = entry.decidedBy;
  if (typeof decidedBy !== 'string' || decidedBy.trim().length === 0) {
    return { valid: false, raw, reason: 'decidedBy must be a non-empty string.' };
  }

  const decidedAt = entry.decidedAt;
  if (typeof decidedAt !== 'string' || decidedAt.trim().length === 0) {
    return { valid: false, raw, reason: 'decidedAt must be a non-empty string.' };
  }

  if (Number.isNaN(Date.parse(decidedAt))) {
    return {
      valid: false,
      raw,
      reason: `decidedAt must be a valid timestamp string; got "${decidedAt}".`,
    };
  }

  return {
    valid: true,
    input: {
      checkpointId: checkpointId.trim(),
      decision: decision as ApprovalDecisionKind,
      reason: reason.trim(),
      decidedBy: decidedBy.trim(),
      decidedAt,
    },
  };
}
