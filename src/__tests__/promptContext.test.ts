import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RepoSnapshot } from "../types.js";
import {
  FEEDBACK_LOOP_PROMPT_POLICY,
  buildTaskCreationPrompt,
  clearPromptContextCache,
  getPromptContextCacheStats,
  getStaticRepoPolicyContext,
} from "../promptContext.js";

function createSnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    owner: "RocketDelivery2",
    repo: "github-copilot-jackhammer-service",
    baseBranch: "main",
    commitSha: "abc123",
    generatedAt: "2026-07-26T00:00:00.000Z",
    fileCount: 1,
    files: [{ path: "README.md", bytes: 100, content: "Sample context" }],
    recentChanges: "abc123 baseline",
    packageHints: ["README.md:\n# JackHammer"],
    ...overrides,
  };
}

describe("prompt context", () => {
  it("assembles task prompt with shared policy fragment and dynamic sections", () => {
    clearPromptContextCache();
    const snapshot = createSnapshot();
    const prompt = buildTaskCreationPrompt({
      snapshot,
      compactContext: "--- FILE: README.md (100 bytes) ---\nSample context",
      guidanceContext: "Recommended Next PR from Copilot: Tighten prompt assembly tests",
      maxTasksPerRun: 3,
    });

    assert.match(
      prompt,
      /You are creating the GitHub Copilot JackHammer Service coding-agent issue queue/,
    );
    assert.match(prompt, /Current commit: abc123/);
    assert.match(prompt, /Recommended Next PR from Copilot/);
    assert.match(prompt, /Repo context:/);
    assert.equal(prompt.split(FEEDBACK_LOOP_PROMPT_POLICY).length - 1, 1);
  });

  it("reuses cached static context for unchanged inputs", () => {
    clearPromptContextCache();
    const snapshot = createSnapshot();

    const first = getStaticRepoPolicyContext(snapshot, 3);
    const second = getStaticRepoPolicyContext(snapshot, 3);

    assert.equal(second, first);
    assert.deepEqual(getPromptContextCacheStats(), {
      hits: 1,
      misses: 1,
      size: 1,
    });
  });

  it("invalidates cache when package hints change", () => {
    clearPromptContextCache();

    const baselineSnapshot = createSnapshot();
    const changedSnapshot = createSnapshot({
      packageHints: ["README.md:\n# JackHammer\n## Updated"],
    });

    const baseline = getStaticRepoPolicyContext(baselineSnapshot, 3);
    const changed = getStaticRepoPolicyContext(changedSnapshot, 3);

    assert.notEqual(changed, baseline);
    assert.deepEqual(getPromptContextCacheStats(), {
      hits: 0,
      misses: 2,
      size: 2,
    });
  });
});
