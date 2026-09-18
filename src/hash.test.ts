import assert from 'node:assert/strict';
import test from 'node:test';
import { taskHash } from './hash.js';
import type { AiTask } from './types.js';

function makeTask(overrides: Partial<AiTask> = {}): AiTask {
  return {
    title: 'Add validation',
    priority: 'medium',
    type: 'feature',
    summary: 'Add bounded validation behavior.',
    target_files: ['src/b.ts', 'src/a.ts'],
    copilot_prompt: 'Implement the validation.',
    acceptance_criteria: ['Validation rejects invalid input.'],
    test_plan: ['Run unit tests.'],
    risk_notes: [],
    ...overrides,
  };
}

test('taskHash is stable across title casing, title whitespace, and target-file order', () => {
  const first = makeTask();
  const second = makeTask({
    title: '  ADD VALIDATION  ',
    target_files: ['src/a.ts', 'src/b.ts'],
  });

  assert.equal(taskHash(first), taskHash(second));
});

test('taskHash changes when hash-significant task content changes', () => {
  const original = makeTask();
  const changedTitle = makeTask({ title: 'Add stricter validation' });
  const changedAcceptance = makeTask({
    acceptance_criteria: ['Validation accepts invalid input.'],
  });

  assert.notEqual(taskHash(original), taskHash(changedTitle));
  assert.notEqual(taskHash(original), taskHash(changedAcceptance));
});

test('taskHash returns a 16-character lowercase hexadecimal digest prefix', () => {
  assert.match(taskHash(makeTask()), /^[0-9a-f]{16}$/);
});
