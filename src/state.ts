import fs from 'node:fs/promises';
import path from 'node:path';
import type { QueueState } from './types.js';

export async function loadState(filePath: string): Promise<QueueState> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as QueueState;
  } catch {
    return { createdIssueHashes: {} };
  }
}

export async function saveState(filePath: string, state: QueueState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
