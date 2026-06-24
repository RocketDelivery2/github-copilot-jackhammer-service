import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseSkillDocument, parseSkillMetadata } from './loader.js';
import { createSkillMetadataIndex } from './registry.js';
import { selectSkillsForTask } from './selector.js';
import { buildSkillApprovalCheckpoints } from './approval-checkpoint.js';
import { applyApprovalDecision, applyApprovalDecisions } from './approval-decision.js';
import { parseDecisionInputs } from './decision-input-source.js';
import { evaluateSkillResourcePolicy, isSkillResourceExecutionAllowed } from './trust-policy.js';

async function readSkillMarkdown(skillName: string): Promise<string> {
  const skillPath = path.join(process.cwd(), 'skills', skillName, 'skill.md');
  return readFile(skillPath, 'utf8');
}

describe('skills front matter and metadata index', () => {
  it('enforces required front matter fields', () => {
    assert.throws(
      () => parseSkillMetadata('---\nname: only-name\n---\nbody'),
      /requires a non-empty "description" field/i,
    );
  });

  it('creates a metadata-only index with required fields', async () => {
    const repoInspection = await readSkillMarkdown('repo-inspection');
    const validation = await readSkillMarkdown('validation');
    const index = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: repoInspection },
      { skillPath: 'skills/validation/skill.md', markdown: validation },
    ], { now: () => '2026-06-23T00:00:00.000Z' });

    assert.equal(index.generatedAt, '2026-06-23T00:00:00.000Z');
    assert.equal(index.skills.length, 2);
    for (const skill of index.skills) {
      assert.ok(skill.name.length > 0);
      assert.ok(skill.description.length > 0);
      assert.ok(skill.version.length > 0);
      assert.ok(['low', 'medium', 'high'].includes(skill.risk));
      assert.ok(Array.isArray(skill.allowedTools));
      assert.ok(Array.isArray(skill.resourceHints));
      assert.equal(Object.prototype.hasOwnProperty.call(skill, 'body'), false);
    }
  });

  it('keeps progressive disclosure: body is loaded only from full document parser', async () => {
    const markdown = await readSkillMarkdown('typescript-patch');
    const metadata = parseSkillMetadata(markdown, 'skills/typescript-patch/skill.md');
    const document = parseSkillDocument(markdown, 'skills/typescript-patch/skill.md');

    assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'body'), false);
    assert.ok(document.body.includes('Inspect relevant symbols first.'));
    assert.ok(document.body.length > 0);
  });
});

describe('deterministic skill selection', () => {
  it('selects validation skill for validation/test/build tasks', async () => {
    const index = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: await readSkillMarkdown('repo-inspection') },
      { skillPath: 'skills/typescript-patch/skill.md', markdown: await readSkillMarkdown('typescript-patch') },
      { skillPath: 'skills/validation/skill.md', markdown: await readSkillMarkdown('validation') },
      { skillPath: 'skills/error-recovery/skill.md', markdown: await readSkillMarkdown('error-recovery') },
    ]);

    const matches = selectSkillsForTask(index, {
      title: 'Run test build lint validation',
      description: 'Need validation summary after patch.',
    });

    assert.ok(matches.length > 0);
    assert.equal(matches[0].skill.name, 'validation');
  });

  it('returns no skills for unknown tasks by default', async () => {
    const index = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: await readSkillMarkdown('repo-inspection') },
      { skillPath: 'skills/typescript-patch/skill.md', markdown: await readSkillMarkdown('typescript-patch') },
    ]);

    const matches = selectSkillsForTask(index, {
      title: 'Unrelated poetry generation',
      description: 'Compose a sonnet about sunsets.',
    });
    assert.deepEqual(matches, []);
  });

  it('supports deterministic fallback skill when configured', async () => {
    const index = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: await readSkillMarkdown('repo-inspection') },
    ]);
    const matches = selectSkillsForTask(
      index,
      { title: 'Unknown task' },
      { fallbackSkillName: 'repo-inspection' },
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].skill.name, 'repo-inspection');
    assert.equal(matches[0].score, 0);
  });
});

describe('trust policy', () => {
  it('marks scripts as requiring human approval and non-executable by default', () => {
    const policy = evaluateSkillResourcePolicy('skills/example/scripts/fix.ps1');
    assert.equal(policy.kind, 'script');
    assert.equal(policy.requiresHumanApproval, true);
    assert.equal(policy.autoExecutable, false);
    assert.equal(isSkillResourceExecutionAllowed('skills/example/scripts/fix.ps1'), false);
  });

  it('allows markdown instructions and references for read-only loading', () => {
    const instructions = evaluateSkillResourcePolicy('skills/repo-inspection/skill.md');
    const reference = evaluateSkillResourcePolicy('skills/repo-inspection/references/git-cheatsheet.md');
    assert.equal(instructions.kind, 'instructions');
    assert.equal(instructions.readAllowed, true);
    assert.equal(reference.kind, 'reference');
    assert.equal(reference.readAllowed, true);
  });
});

describe('required skill content rules', () => {
  it('repo-inspection skill blocks full-file dumps and enforces bounded inspect-then-act', async () => {
    const document = parseSkillDocument(await readSkillMarkdown('repo-inspection'));
    assert.ok(document.body.includes('Do not use full-file Get-Content -Raw on large files by default.'));
    assert.ok(document.body.includes('After 2-3 inspection commands, patch, ask, or stop.'));
  });

  it('typescript-patch skill enforces bounded inspection before patching', async () => {
    const document = parseSkillDocument(await readSkillMarkdown('typescript-patch'));
    assert.ok(document.body.includes('Inspect relevant symbols first.'));
    assert.ok(document.body.includes('Bound inspection to only the files and line ranges needed before patching.'));
  });

  it('error-recovery skill turns failures into one next repair command', async () => {
    const document = parseSkillDocument(await readSkillMarkdown('error-recovery'));
    assert.ok(document.body.includes('Produce exactly one next repair command.'));
    assert.ok(document.body.includes('Avoid repeating the same broken command form.'));
    assert.ok(document.body.includes('Prefer here-string or temp-file scripts over fragile node -e quoting for multiline patches.'));
  });
});

describe('no production scheduling behavior changes', () => {
  it('metadata index generation is deterministic regardless of source order', async () => {
    const repoInspection = await readSkillMarkdown('repo-inspection');
    const validation = await readSkillMarkdown('validation');

    const left = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: repoInspection },
      { skillPath: 'skills/validation/skill.md', markdown: validation },
    ]);

    const right = createSkillMetadataIndex([
      { skillPath: 'skills/validation/skill.md', markdown: validation },
      { skillPath: 'skills/repo-inspection/skill.md', markdown: repoInspection },
    ]);

    assert.deepEqual(left.skills.map(skill => skill.name), right.skills.map(skill => skill.name));
  });
});

describe('approval checkpoint model', () => {
  it('creates deterministic approval checkpoints from execution plans', () => {
    const plans = [{
      taskId: 'issue:1',
      skillName: 'validation',
      selectionRank: 1,
      selectionScore: 8,
      selectionReasons: ['keyword:validation'],
      risk: 'high' as const,
      allowedTools: ['npm.cmd'],
      plannedSteps: [{ index: 1, summary: 'Run npm.cmd test' }],
      trustPolicySummary: {
        instructionsReadAllowed: true,
        referencesReadAllowed: true,
        assetsReadAllowed: true,
        scriptsRequireHumanApproval: true,
        scriptsAutoExecutable: false,
        scriptExecutionBlocked: true,
      },
    }];

    const first = buildSkillApprovalCheckpoints({ plans, maxCheckpoints: 8 });
    const second = buildSkillApprovalCheckpoints({ plans, maxCheckpoints: 8 });
    assert.deepEqual(first, second);
    assert.ok(first.some(entry => entry.resourceType === 'script' && entry.approvalState === 'pending'));
    assert.ok(first.some(entry => entry.resourceType === 'risk_gate' && entry.approvalState === 'pending'));
  });
});

describe('approval decision model', () => {
  const baseCheckpoint = {
    checkpointId: 'script:issue:1:validation',
    taskId: 'issue:1',
    skillName: 'validation',
    resourceType: 'script' as const,
    reason: 'Script requires approval.',
    risk: 'high' as const,
    approvalState: 'pending' as const,
    createdSource: 'adaptive-preview' as const,
  };

  const baseInput = {
    checkpointId: 'script:issue:1:validation',
    reason: 'Approved for preview.',
    decidedBy: 'human-preview',
    decidedAt: '2026-06-23T21:00:00.000Z',
  };

  it('pending checkpoint can be approved deterministically', () => {
    const t1 = applyApprovalDecision(baseCheckpoint, { ...baseInput, decision: 'approve' });
    const t2 = applyApprovalDecision(baseCheckpoint, { ...baseInput, decision: 'approve' });

    assert.deepEqual(t1, t2);
    assert.equal(t1.transitionResult, 'applied');
    assert.equal(t1.updatedCheckpoint.approvalState, 'approved');
    assert.equal(t1.originalCheckpoint.approvalState, 'pending');
  });

  it('pending checkpoint can be rejected deterministically', () => {
    const transition = applyApprovalDecision(baseCheckpoint, { ...baseInput, decision: 'reject' });

    assert.equal(transition.transitionResult, 'applied');
    assert.equal(transition.updatedCheckpoint.approvalState, 'rejected');
  });

  it('reset transitions back to pending deterministically', () => {
    const approved = { ...baseCheckpoint, approvalState: 'approved' as const };
    const transition = applyApprovalDecision(approved, { ...baseInput, decision: 'reset' });

    assert.equal(transition.transitionResult, 'applied');
    assert.equal(transition.updatedCheckpoint.approvalState, 'pending');
  });

  it('already approved checkpoint cannot be approved again', () => {
    const approved = { ...baseCheckpoint, approvalState: 'approved' as const };
    const transition = applyApprovalDecision(approved, { ...baseInput, decision: 'approve' });

    assert.equal(transition.transitionResult, 'ignored');
    assert.equal(transition.updatedCheckpoint.approvalState, 'approved');
    assert.ok(transition.transitionReason?.includes('already resolved'));
  });

  it('already rejected checkpoint cannot be rejected again', () => {
    const rejected = { ...baseCheckpoint, approvalState: 'rejected' as const };
    const transition = applyApprovalDecision(rejected, { ...baseInput, decision: 'reject' });

    assert.equal(transition.transitionResult, 'ignored');
    assert.ok(transition.transitionReason?.includes('already resolved'));
  });

  it('not_required checkpoint cannot be approved or rejected', () => {
    const notRequired = { ...baseCheckpoint, approvalState: 'not_required' as const };

    const approveT = applyApprovalDecision(notRequired, { ...baseInput, decision: 'approve' });
    assert.equal(approveT.transitionResult, 'ignored');
    assert.ok(approveT.transitionReason?.includes('does not require approval'));

    const rejectT = applyApprovalDecision(notRequired, { ...baseInput, decision: 'reject' });
    assert.equal(rejectT.transitionResult, 'ignored');
  });

  it('not_required checkpoint cannot be reset', () => {
    const notRequired = { ...baseCheckpoint, approvalState: 'not_required' as const };
    const transition = applyApprovalDecision(notRequired, { ...baseInput, decision: 'reset' });

    assert.equal(transition.transitionResult, 'ignored');
    assert.ok(transition.transitionReason?.includes('cannot be reset'));
  });

  it('rejected checkpoint remains non-executable', () => {
    const transition = applyApprovalDecision(baseCheckpoint, { ...baseInput, decision: 'reject' });

    assert.equal(transition.transitionResult, 'applied');
    assert.equal(transition.updatedCheckpoint.approvalState, 'rejected');
    assert.notEqual(transition.updatedCheckpoint.approvalState, 'approved');
  });

  it('approved checkpoint only changes approval metadata, no execution side effects', () => {
    const transition = applyApprovalDecision(baseCheckpoint, { ...baseInput, decision: 'approve' });

    assert.equal(transition.transitionResult, 'applied');
    assert.equal(transition.updatedCheckpoint.approvalState, 'approved');
    assert.equal(transition.updatedCheckpoint.skillName, baseCheckpoint.skillName);
    assert.equal(transition.updatedCheckpoint.checkpointId, baseCheckpoint.checkpointId);
    assert.equal(Object.prototype.hasOwnProperty.call(transition.updatedCheckpoint, 'autoExecutable'), false);
  });

  it('checkpoint ID mismatch produces invalid transition', () => {
    const transition = applyApprovalDecision(baseCheckpoint, {
      ...baseInput,
      checkpointId: 'wrong:id',
      decision: 'approve',
    });

    assert.equal(transition.transitionResult, 'invalid');
    assert.ok(transition.transitionReason?.includes('mismatch'));
  });

  it('unknown decision kind produces invalid transition', () => {
    const transition = applyApprovalDecision(baseCheckpoint, {
      ...baseInput,
      decision: 'unknown-kind' as 'approve',
    });

    assert.equal(transition.transitionResult, 'invalid');
    assert.ok(transition.transitionReason?.includes('Unknown decision kind'));
  });

  it('applyApprovalDecisions handles unknown checkpoint ID as invalid', () => {
    const transitions = applyApprovalDecisions([], [{
      ...baseInput,
      decision: 'approve',
    }]);

    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].transitionResult, 'invalid');
    assert.ok(transitions[0].transitionReason?.includes('No checkpoint'));
  });

  it('batch decisions apply state transitions sequentially', () => {
    const checkpoints = [baseCheckpoint];
    const transitions = applyApprovalDecisions(checkpoints, [
      { ...baseInput, decision: 'approve' },
      { ...baseInput, decision: 'approve', reason: 'second attempt' },
    ]);

    assert.equal(transitions.length, 2);
    assert.equal(transitions[0].transitionResult, 'applied');
    assert.equal(transitions[1].transitionResult, 'ignored');
  });

  it('no production scheduling behavior changes', () => {
    const checkpoints = [baseCheckpoint];
    const t1 = applyApprovalDecisions(checkpoints, [{ ...baseInput, decision: 'approve' }]);
    const t2 = applyApprovalDecisions(checkpoints, [{ ...baseInput, decision: 'approve' }]);

    assert.deepEqual(t1, t2);
    assert.equal(baseCheckpoint.approvalState, 'pending');
  });
});

describe('approval decision input source', () => {
  it('empty array returns empty result', () => {
    const result = parseDecisionInputs([]);
    assert.deepEqual(result.inputs, []);
    assert.deepEqual(result.invalid, []);
  });

  it('valid input parses correctly', () => {
    const result = parseDecisionInputs([{
      checkpointId: 'script:issue:1:validation',
      decision: 'approve',
      reason: 'Approved for preview.',
      decidedBy: 'human-preview',
      decidedAt: '2026-06-23T21:00:00.000Z',
    }]);

    assert.equal(result.inputs.length, 1);
    assert.equal(result.invalid.length, 0);
    assert.equal(result.inputs[0].checkpointId, 'script:issue:1:validation');
    assert.equal(result.inputs[0].decision, 'approve');
    assert.equal(result.inputs[0].decidedBy, 'human-preview');
  });

  it('non-object entry is invalid', () => {
    const result = parseDecisionInputs([42, 'not-an-object', null]);
    assert.equal(result.inputs.length, 0);
    assert.equal(result.invalid.length, 3);
  });

  it('missing required field produces invalid entry', () => {
    const result = parseDecisionInputs([{
      checkpointId: 'script:issue:1:validation',
      decision: 'approve',
    }]);
    assert.equal(result.inputs.length, 0);
    assert.equal(result.invalid.length, 1);
    assert.ok(result.invalid[0].reason.includes('reason'));
  });

  it('invalid decision kind is rejected', () => {
    const result = parseDecisionInputs([{
      checkpointId: 'script:issue:1:validation',
      decision: 'explode',
      reason: 'test',
      decidedBy: 'human',
      decidedAt: '2026-06-23T21:00:00.000Z',
    }]);
    assert.equal(result.inputs.length, 0);
    assert.equal(result.invalid.length, 1);
    assert.ok(result.invalid[0].reason.includes('approve, reject, reset'));
  });

  it('invalid timestamp is rejected', () => {
    const result = parseDecisionInputs([{
      checkpointId: 'script:issue:1:validation',
      decision: 'approve',
      reason: 'test',
      decidedBy: 'human',
      decidedAt: 'not-a-date',
    }]);
    assert.equal(result.inputs.length, 0);
    assert.equal(result.invalid.length, 1);
    assert.ok(result.invalid[0].reason.includes('timestamp'));
  });

  it('non-array root throws', () => {
    assert.throws(() => parseDecisionInputs({ not: 'an array' }), /must be a JSON array/);
    assert.throws(() => parseDecisionInputs('string'), /must be a JSON array/);
    assert.throws(() => parseDecisionInputs(null), /must be a JSON array/);
  });

  it('valid and invalid entries are separated deterministically', () => {
    const result = parseDecisionInputs([
      {
        checkpointId: 'script:issue:1:validation',
        decision: 'approve',
        reason: 'Approved.',
        decidedBy: 'human-preview',
        decidedAt: '2026-06-23T21:00:00.000Z',
      },
      { bad: 'entry' },
      {
        checkpointId: 'risk:issue:2:typescript-patch',
        decision: 'reject',
        reason: 'Too risky.',
        decidedBy: 'human-preview',
        decidedAt: '2026-06-23T21:01:00.000Z',
      },
    ]);
    assert.equal(result.inputs.length, 2);
    assert.equal(result.invalid.length, 1);
    assert.equal(result.inputs[0].decision, 'approve');
    assert.equal(result.inputs[1].decision, 'reject');
  });

  it('all three valid decision kinds parse without error', () => {
    const base = {
      checkpointId: 'x:issue:1:validation',
      reason: 'test',
      decidedBy: 'human',
      decidedAt: '2026-06-23T21:00:00.000Z',
    };
    for (const decision of ['approve', 'reject', 'reset'] as const) {
      const result = parseDecisionInputs([{ ...base, decision }]);
      assert.equal(result.inputs.length, 1, `Expected decision "${decision}" to be valid`);
    }
  });
});
