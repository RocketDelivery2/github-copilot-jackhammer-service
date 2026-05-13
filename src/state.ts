import fs from 'node:fs/promises';
import path from 'node:path';
import type { QueueState } from './types.js';

const DEFAULT_STATE: QueueState = {
  createdIssueHashes: {},
  commandQueue: [],
  recentCopilotResults: [],
};

export async function loadState(filePath: string): Promise<QueueState> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<QueueState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      commandQueue: parsed.commandQueue ?? [],
      recentCopilotResults: parsed.recentCopilotResults ?? [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(filePath: string, state: QueueState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
