import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const reviewerPromptPaths = [
  ".github/codex/prompts/project-monitor.md",
  ".github/codex/prompts/architecture-reviewer.md",
  ".github/codex/prompts/algorithm-performance-reviewer.md",
  ".github/codex/prompts/safety-test-reviewer.md",
  ".github/codex/prompts/security-reviewer.md",
  ".github/codex/prompts/dependency-reviewer.md",
  ".github/codex/prompts/docs-reviewer.md",
  ".github/codex/prompts/regression-test-planner.md",
  ".github/codex/prompts/release-manager.md",
  ".github/codex/prompts/azure-readiness-reviewer.md",
  ".github/codex/prompts/merge-governor.md",
] as const;

const runbookPath = "docs/CODEX_REVIEWER_PROMPTS.md";

function readRepoFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

test("Codex reviewer prompt inventory files exist", () => {
  for (const promptPath of reviewerPromptPaths) {
    assert.ok(
      existsSync(join(process.cwd(), promptPath)),
      `Expected Codex reviewer prompt to exist: ${promptPath}`,
    );
  }
});

test("Codex reviewer prompt runbook exists", () => {
  assert.ok(
    existsSync(join(process.cwd(), runbookPath)),
    `Expected Codex reviewer prompt runbook to exist: ${runbookPath}`,
  );
});

test("Codex reviewer prompt runbook references every reviewer prompt", () => {
  const runbook = readRepoFile(runbookPath);

  for (const promptPath of reviewerPromptPaths) {
    const promptName = promptPath.split("/").at(-1);

    assert.ok(promptName, `Expected prompt file name for path: ${promptPath}`);

    const expectedReference = ["`", promptName, "`"].join("");

    assert.ok(
      runbook.includes(expectedReference),
      `Expected runbook to reference prompt: ${promptName}`,
    );
  }
});
