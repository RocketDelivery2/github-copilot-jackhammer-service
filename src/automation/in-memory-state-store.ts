import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AutomationRunState } from './automation-run.js';

export type AutomationStateStore = {
  load(): Promise<AutomationRunState | undefined>;
  save(state: AutomationRunState): Promise<void>;
};

export function createInMemoryStateStore(initialState?: AutomationRunState): AutomationStateStore & { snapshot(): AutomationRunState | undefined } {
  let current = initialState ? clone(initialState) : undefined;

  return {
    async load() {
      return current ? clone(current) : undefined;
    },
    async save(state: AutomationRunState) {
      current = clone(state);
    },
    snapshot() {
      return current ? clone(current) : undefined;
    },
  };
}

export async function saveAutomationState(filePath: string, state: AutomationRunState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function loadAutomationState(filePath: string): Promise<AutomationRunState | undefined> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as AutomationRunState;
    return parsed;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function clone(state: AutomationRunState): AutomationRunState {
  return JSON.parse(JSON.stringify(state)) as AutomationRunState;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}
