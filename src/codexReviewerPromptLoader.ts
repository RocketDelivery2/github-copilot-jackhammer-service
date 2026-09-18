import { readFile } from "node:fs/promises";
import {
  codexReviewerPromptInventory,
  reviewerPromptFilenames,
  reviewerPrompts,
} from "./codexReviewerPromptInventory.js";
import type { CodexReviewerPromptInventoryItem } from "./codexReviewerPromptInventory.js";

export {
  codexReviewerPromptInventory,
  reviewerPromptFilenames,
  reviewerPrompts,
};

export type { CodexReviewerPromptInventoryItem };

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

  public async loadPrompt(id: string): Promise<string> {
    const promptPath = this.getPromptPath(id);

    try {
      return await readFile(promptPath, "utf8");
    } catch (error: unknown) {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT"
      ) {
        throw new Error(`Prompt file not found: ${promptPath}`);
      }

      throw error;
    }
  }
}

export const codexReviewerPromptLoader = new CodexReviewerPromptLoader();
