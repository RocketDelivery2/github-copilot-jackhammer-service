import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  CodexReviewerPromptLoader,
  codexReviewerPromptInventory,
  reviewerPromptFilenames,
} from "../codexReviewerPromptLoader.js";
import type { CodexReviewerPromptInventoryItem } from "../codexReviewerPromptLoader.js";

test("CodexReviewerPromptLoader exposes the canonical reviewer prompt inventory", () => {
  assert.equal(codexReviewerPromptInventory.length, reviewerPromptFilenames.length);
  assert.equal(codexReviewerPromptInventory.length, 10);

  for (const item of codexReviewerPromptInventory) {
    assert.ok(item.id.length > 0);
    assert.ok(item.displayName.length > 0);
    assert.ok(item.filename.endsWith(".md"));
    assert.equal(item.repoPath, `.github/codex/prompts/${item.filename}`);
    assert.ok(item.purpose.length > 0);
  }
});

test("CodexReviewerPromptLoader lists prompt ids in inventory order", () => {
  const loader = new CodexReviewerPromptLoader();
  const expectedIds = codexReviewerPromptInventory.map(
    (item: CodexReviewerPromptInventoryItem) => item.id,
  );

  assert.deepEqual(loader.listPromptIds(), expectedIds);
  assert.equal(new Set(loader.listPromptIds()).size, expectedIds.length);
});

test("CodexReviewerPromptLoader returns prompt metadata by id", () => {
  const loader = new CodexReviewerPromptLoader();

  for (const item of codexReviewerPromptInventory) {
    assert.deepEqual(loader.getPromptInfo(item.id), item);
    assert.equal(loader.getPromptPath(item.id), item.repoPath);
  }
});

test("CodexReviewerPromptLoader throws for unknown prompt id", () => {
  const loader = new CodexReviewerPromptLoader();

  assert.throws(() => loader.getPromptInfo("__missing__"), /Unknown prompt id/);
  assert.throws(() => loader.getPromptPath("__missing__"), /Unknown prompt id/);
  assert.throws(() => loader.loadPrompt("__missing__"), /Unknown prompt id/);
});

test("CodexReviewerPromptLoader loads all known prompt files", () => {
  const loader = new CodexReviewerPromptLoader();

  for (const item of codexReviewerPromptInventory) {
    assert.ok(existsSync(item.repoPath), `Expected prompt file to exist: ${item.repoPath}`);

    const content = loader.loadPrompt(item.id);

    assert.equal(typeof content, "string");
    assert.ok(content.trim().length > 0, `Expected prompt file to have content: ${item.repoPath}`);
  }
});

test("CodexReviewerPromptLoader throws when a known prompt file is missing", () => {
  const first = codexReviewerPromptInventory[0];
  assert.ok(first, "Expected at least one prompt in inventory");

  const missingPrompt = {
    ...first,
    id: "__missing_file__",
    repoPath: "__missing__/prompt.md",
  };

  const loader = new CodexReviewerPromptLoader([missingPrompt]);

  assert.throws(() => loader.loadPrompt("__missing_file__"), /Prompt file not found/);
});
