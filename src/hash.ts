import crypto from 'node:crypto';
import type { AiTask } from './types.js';

export function taskHash(task: AiTask): string {
  const stable = JSON.stringify({
    title: task.title.trim().toLowerCase(),
    target_files: [...task.target_files].sort(),
    acceptance_criteria: task.acceptance_criteria
  });
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16);
}
