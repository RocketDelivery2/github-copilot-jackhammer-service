import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectCopilotQuestion,
  extractPlanSteps,
  extractRecommendedNextPR,
  extractNotes,
  extractValidation,
  extractBlockers,
  stripWrapperText,
  ensureNotesSection,
  rebalanceQueue,
} from '../brain.js';
import type { CommandQueueItem, CopilotGuidance } from '../types.js';

// ─── detectCopilotQuestion ───────────────────────────────────────────────────

describe('detectCopilotQuestion', () => {
  it('detects "which direction would you like to go"', () => {
    assert.equal(detectCopilotQuestion('Which direction would you like to go?'), true);
  });

  it('detects "could you clarify"', () => {
    assert.equal(detectCopilotQuestion('Could you clarify the requirements?'), true);
  });

  it('detects "please clarify"', () => {
    assert.equal(detectCopilotQuestion('Please clarify which approach to use.'), true);
  });

  it('detects "would you like me to"', () => {
    assert.equal(detectCopilotQuestion('Would you like me to implement option A or option B?'), true);
  });

  it('detects "should i proceed"', () => {
    assert.equal(detectCopilotQuestion('Should I proceed with the refactor?'), true);
  });

  it('returns false for normal progress update', () => {
    assert.equal(detectCopilotQuestion('I have implemented the changes to src/brain.ts as requested.'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(detectCopilotQuestion(''), false);
  });
});

// ─── extractPlanSteps ────────────────────────────────────────────────────────

describe('extractPlanSteps', () => {
  it('extracts numbered steps from a Plan Steps section', () => {
    const text = `
## Plan Steps
1. Add the brain module
2. Update the config
3. Write tests
`;
    const steps = extractPlanSteps(text);
    assert.equal(steps.length, 3);
    assert.equal(steps[0], 'Add the brain module');
    assert.equal(steps[1], 'Update the config');
    assert.equal(steps[2], 'Write tests');
  });

  it('extracts numbered steps without a section header', () => {
    const text = '1. First step\n2. Second step\n3. Third step';
    const steps = extractPlanSteps(text);
    assert.ok(steps.length >= 3);
  });

  it('returns empty array when no steps found', () => {
    const steps = extractPlanSteps('No steps here, just prose text.');
    assert.equal(steps.length, 0);
  });

  it('handles "Step N:" prefix', () => {
    const text = 'Step 1. Setup environment\nStep 2. Run tests';
    const steps = extractPlanSteps(text);
    assert.ok(steps.length >= 1);
  });
});

// ─── extractRecommendedNextPR ────────────────────────────────────────────────

describe('extractRecommendedNextPR', () => {
  it('extracts the recommended next PR title', () => {
    const text = 'Recommended Next PR: Add brain module tests';
    assert.equal(extractRecommendedNextPR(text), 'Add brain module tests');
  });

  it('is case-insensitive', () => {
    const text = 'RECOMMENDED NEXT PR: Fix the lint errors';
    assert.equal(extractRecommendedNextPR(text), 'Fix the lint errors');
  });

  it('returns null when not present', () => {
    assert.equal(extractRecommendedNextPR('Nothing relevant here.'), null);
  });

  it('extracts multiword titles', () => {
    const text = 'Recommended Next PR: Implement full autopilot orchestration layer';
    assert.equal(extractRecommendedNextPR(text), 'Implement full autopilot orchestration layer');
  });
});

// ─── extractNotes ────────────────────────────────────────────────────────────

describe('extractNotes', () => {
  it('extracts bullet points from a Notes section', () => {
    const text = `
## Notes
- Be careful with the API rate limits.
- Do not merge until tests pass.
`;
    const notes = extractNotes(text);
    assert.ok(notes.includes('Be careful with the API rate limits.'));
    assert.ok(notes.includes('Do not merge until tests pass.'));
  });

  it('returns empty array when no Notes section', () => {
    assert.deepEqual(extractNotes('No notes here.'), []);
  });

  it('handles "None." as a valid note', () => {
    const text = 'Notes:\n- None.';
    const notes = extractNotes(text);
    assert.ok(notes.includes('None.'));
  });
});

// ─── extractValidation ───────────────────────────────────────────────────────

describe('extractValidation', () => {
  it('extracts bullet points from a Validation section', () => {
    const text = `
## Validation
- Run npm test
- Run npm run build
`;
    const items = extractValidation(text);
    assert.ok(items.includes('Run npm test'));
    assert.ok(items.includes('Run npm run build'));
  });

  it('returns empty array when no Validation section', () => {
    assert.deepEqual(extractValidation('No validation here.'), []);
  });
});

// ─── extractBlockers ─────────────────────────────────────────────────────────

describe('extractBlockers', () => {
  it('extracts items from a Blockers section', () => {
    const text = `
## Blockers
- Missing API credentials
- Database migration not ready
`;
    const blockers = extractBlockers(text);
    assert.ok(blockers.includes('Missing API credentials'));
    assert.ok(blockers.includes('Database migration not ready'));
  });
});

// ─── stripWrapperText ────────────────────────────────────────────────────────

describe('stripWrapperText', () => {
  it('strips "Generate this into a copilot command" prefix', () => {
    const input = 'Generate this into a copilot command:\n\nGoal: Implement feature X.';
    const result = stripWrapperText(input);
    assert.ok(!result.includes('Generate this into a copilot command'));
    assert.ok(result.includes('Goal: Implement feature X.'));
  });

  it('strips "Here is your copilot command" prefix', () => {
    const input = 'Here is your copilot command:\n\nGoal: Fix the bug.';
    const result = stripWrapperText(input);
    assert.ok(!result.includes('Here is your copilot command'));
  });

  it('returns original text unchanged when no wrapper present', () => {
    const input = 'Goal: Implement feature X.\n\nNotes:\n- None.';
    assert.equal(stripWrapperText(input), input);
  });
});

// ─── ensureNotesSection ──────────────────────────────────────────────────────

describe('ensureNotesSection', () => {
  it('appends Notes section when absent', () => {
    const prompt = 'Goal: Implement the feature.\n\nTasks:\n- Do something.';
    const result = ensureNotesSection(prompt);
    assert.ok(result.includes('Notes:'));
    assert.ok(result.includes('- None.'));
  });

  it('does not duplicate Notes when already present', () => {
    const prompt = 'Goal: Fix bug.\n\nNotes:\n- Watch out for edge cases.';
    const result = ensureNotesSection(prompt);
    const matches = [...result.matchAll(/^Notes:/gim)];
    assert.equal(matches.length, 1);
  });

  it('preserves existing Notes content', () => {
    const prompt = 'Goal: Do something.\n\nNotes:\n- Important caveat.';
    const result = ensureNotesSection(prompt);
    assert.ok(result.includes('Important caveat.'));
  });
});

// ─── rebalanceQueue ──────────────────────────────────────────────────────────

describe('rebalanceQueue', () => {
  const makeItem = (title: string, priority: 'low' | 'medium' | 'high' = 'medium'): CommandQueueItem => ({
    hash: title.slice(0, 8),
    title,
    priority,
    prompt: `Implement ${title}`,
  });

  it('promotes the Recommended Next PR to the front', () => {
    const queue = [
      makeItem('Fix lint errors'),
      makeItem('Add feature X'),
      makeItem('Update documentation'),
    ];
    const guidance: CopilotGuidance = {
      recommendedNextPR: 'Update documentation',
      planSteps: [],
      notes: [],
      validation: [],
      blockers: [],
      errors: [],
      hasCopilotQuestion: false,
      rawText: '',
      extractedAt: new Date().toISOString(),
    };
    const rebalanced = rebalanceQueue(queue, { guidance, failedChecks: false, hasTests: false, hasBuildIssue: false, hasLintIssue: false, isProductionReady: false });
    assert.equal(rebalanced[0]!.title, 'Update documentation');
  });

  it('deprioritises blocked items', () => {
    const queue = [
      makeItem('Deploy to production'),
      makeItem('Fix unit tests'),
    ];
    const guidance: CopilotGuidance = {
      recommendedNextPR: null,
      planSteps: [],
      notes: [],
      validation: [],
      blockers: ['deploy to production'],
      errors: [],
      hasCopilotQuestion: false,
      rawText: '',
      extractedAt: new Date().toISOString(),
    };
    const rebalanced = rebalanceQueue(queue, { guidance, failedChecks: false, hasTests: false, hasBuildIssue: false, hasLintIssue: false, isProductionReady: false });
    assert.equal(rebalanced[rebalanced.length - 1]!.title, 'Deploy to production');
  });

  it('boosts build-related items when hasBuildIssue is true', () => {
    const queue = [
      makeItem('Add new feature', 'low'),
      makeItem('Fix build error', 'low'),
    ];
    const rebalanced = rebalanceQueue(queue, {
      guidance: null,
      failedChecks: false,
      hasTests: false,
      hasBuildIssue: true,
      hasLintIssue: false,
      isProductionReady: false,
    });
    assert.equal(rebalanced[0]!.title, 'Fix build error');
  });

  it('preserves order when no signals apply', () => {
    const queue = [
      makeItem('Task A', 'high'),
      makeItem('Task B', 'medium'),
      makeItem('Task C', 'low'),
    ];
    const rebalanced = rebalanceQueue(queue, {
      guidance: null,
      failedChecks: false,
      hasTests: false,
      hasBuildIssue: false,
      hasLintIssue: false,
      isProductionReady: false,
    });
    assert.equal(rebalanced[0]!.title, 'Task A');
    assert.equal(rebalanced[1]!.title, 'Task B');
    assert.equal(rebalanced[2]!.title, 'Task C');
  });
});
