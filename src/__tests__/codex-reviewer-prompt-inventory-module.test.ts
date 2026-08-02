import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  codexReviewerPromptInventory,
  reviewerPromptFilenames,
  reviewerPrompts,
} from '../codexReviewerPromptInventory.js';

test('prompt inventory module exports aligned metadata', () => {
  assert.equal(codexReviewerPromptInventory.length, reviewerPromptFilenames.length);
  assert.equal(reviewerPrompts.length, codexReviewerPromptInventory.length);
});

test('prompt inventory ids are unique and mapped from filenames', () => {
  const ids = codexReviewerPromptInventory.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const item of codexReviewerPromptInventory) {
    assert.equal(item.id, item.filename.replace(/\.md$/, ''));
    assert.equal(item.repoPath, `.github/codex/prompts/${item.filename}`);
  }
});