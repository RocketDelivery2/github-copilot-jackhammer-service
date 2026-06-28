import { existsSync, readFileSync } from "node:fs";

export interface CodexReviewerPromptInventoryItem {
  id: string;
  displayName: string;
  filename: string;
  repoPath: string;
  purpose: string;
}

export const reviewerPromptFilenames = [
  "project-monitor.md",
  "architecture-reviewer.md",
  "safety-test-reviewer.md",
  "security-reviewer.md",
  "dependency-reviewer.md",
  "docs-reviewer.md",
  "regression-test-planner.md",
  "release-manager.md",
  "azure-readiness-reviewer.md",
  "merge-governor.md",
] as const;

const purposeById: Record<string, string> = {
  "project-monitor": "Tracks project state, health, and next work signals.",
  "architecture-reviewer": "Reviews architecture, boundaries, and maintainability.",
  "safety-test-reviewer": "Reviews test safety, edge cases, and validation risk.",
  "security-reviewer": "Reviews security posture and sensitive change risk.",
  "dependency-reviewer": "Reviews dependency, supply-chain, and package risk.",
  "docs-reviewer": "Reviews documentation quality and completeness.",
  "regression-test-planner": "Plans regression coverage for changed behavior.",
  "release-manager": "Reviews release readiness and rollout safety.",
  "azure-readiness-reviewer": "Reviews Azure and production-readiness concerns.",
  "merge-governor": "Reviews merge readiness and branch-protection safety.",
};

function idFromFilename(filename: string): string {
  return filename.replace(/\.md$/, "");
}

function displayNameFromId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export const codexReviewerPromptInventory: readonly CodexReviewerPromptInventoryItem[] =
  reviewerPromptFilenames.map((filename) => {
    const id = idFromFilename(filename);

    return {
      id,
      displayName: displayNameFromId(id),
      filename,
      repoPath: `.github/codex/prompts/${filename}`,
      purpose: purposeById[id] ?? "Codex reviewer prompt.",
    };
  });

export const reviewerPrompts = codexReviewerPromptInventory;

export class CodexReviewerPromptLoader {
  private readonly inventory: readonly CodexReviewerPromptInventoryItem[];

  public constructor(
    inventory: readonly CodexReviewerPromptInventoryItem[] = codexReviewerPromptInventory,
  ) {
    this.inventory = inventory;
  }

  public listPromptIds(): string[] {
    return this.inventory.map((item) => item.id);
  }

  public listPrompts(): readonly CodexReviewerPromptInventoryItem[] {
    return this.inventory;
  }

  public getPromptInfo(id: string): CodexReviewerPromptInventoryItem {
    const item = this.inventory.find((candidate) => candidate.id === id);

    if (!item) {
      throw new Error(`Unknown prompt id: ${id}`);
    }

    return item;
  }

  public getPromptPath(id: string): string {
    return this.getPromptInfo(id).repoPath;
  }

  public loadPrompt(id: string): string {
    const promptPath = this.getPromptPath(id);

    if (!existsSync(promptPath)) {
      throw new Error(`Prompt file not found: ${promptPath}`);
    }

    return readFileSync(promptPath, "utf8");
  }
}

export const codexReviewerPromptLoader = new CodexReviewerPromptLoader();
