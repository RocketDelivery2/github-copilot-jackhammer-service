/**
 * Determines whether two work items can run in parallel and plans safe runnable
 * batches from a queue, respecting barrier commands, shared worktrees, overlapping
 * write paths, and incomplete dependencies.
 */
import type { ParallelismDecision, WorkItem } from './types.js';

const BARRIER_COMMAND_PATTERN =
  /\b(?:git\s+(?:checkout|switch|merge|rebase|reset|clean|pull|push|stash)|npm\s+(?:install|ci)|pnpm\s+install|yarn\s+install|docker\s+compose)\b/i;

export function canRunInParallel(
  a: WorkItem,
  b: WorkItem,
  completedIds: ReadonlySet<string> = new Set()
): ParallelismDecision {
  if (!isRunnableStatus(a) || !isRunnableStatus(b)) {
    return reject('Only pending or running work items can be considered for parallel execution.');
  }

  if (hasIncompletePairDependency(a, b, completedIds) || hasIncompletePairDependency(b, a, completedIds)) {
    return reject('A dependency is incomplete.');
  }

  if (isRunningBarrier(a) || isRunningBarrier(b)) {
    return reject('A barrier command is already running.');
  }

  if (isBarrierItem(a) || isBarrierItem(b)) {
    return reject('Barrier commands must run without parallel work.');
  }

  const overlappingPaths = overlappingWritePaths(a.writePaths ?? [], b.writePaths ?? []);
  if (overlappingPaths.length > 0) {
    return reject('Write paths overlap.', overlappingPaths);
  }

  const aWorktree = normalizePath(a.worktree ?? '');
  const bWorktree = normalizePath(b.worktree ?? '');
  if (aWorktree && bWorktree && aWorktree === bWorktree) {
    return reject('Both work items share the same worktree.', [a.worktree ?? '', b.worktree ?? '']);
  }

  return {
    canRun: true,
    reason: 'Work items can run in parallel.',
    conflicts: [],
  };
}

export function planRunnableBatch(queue: readonly WorkItem[], maxParallel: number): WorkItem[] {
  const limit = Math.max(0, Math.floor(maxParallel));
  if (limit === 0) return [];

  const runningItems = queue.filter(item => item.status === 'running');
  if (runningItems.some(isBarrierItem)) return [];

  const completedIds = new Set(queue.filter(item => item.status === 'completed').map(item => item.id));
  const batch: WorkItem[] = [];

  for (const candidate of queue) {
    if (candidate.status !== 'pending') continue;
    if (!dependenciesComplete(candidate, completedIds)) continue;

    if (isBarrierItem(candidate)) {
      if (batch.length === 0 && runningItems.length === 0) return [candidate];
      continue;
    }

    if (runningItems.some(running => !canRunInParallel(candidate, running, completedIds).canRun)) continue;
    if (batch.some(selected => !canRunInParallel(candidate, selected, completedIds).canRun)) continue;

    batch.push(candidate);
    if (batch.length >= limit) break;
  }

  return batch;
}

function reject(reason: string, conflicts: string[] = []): ParallelismDecision {
  return {
    canRun: false,
    reason,
    conflicts,
  };
}

function isRunnableStatus(item: WorkItem): boolean {
  return item.status === 'pending' || item.status === 'running';
}

function isBarrierItem(item: WorkItem): boolean {
  return item.isBarrier === true || Boolean(item.command && BARRIER_COMMAND_PATTERN.test(item.command));
}

function isRunningBarrier(item: WorkItem): boolean {
  return item.status === 'running' && isBarrierItem(item);
}

function hasIncompletePairDependency(
  item: WorkItem,
  other: WorkItem,
  completedIds: ReadonlySet<string>
): boolean {
  return (item.dependsOn ?? []).some(dependencyId => {
    if (dependencyId === item.id) return true;
    if (completedIds.has(dependencyId)) return false;
    if (dependencyId === other.id) return other.status !== 'completed';
    return true;
  });
}

function dependenciesComplete(item: WorkItem, completedIds: ReadonlySet<string>): boolean {
  return (item.dependsOn ?? []).every(id => completedIds.has(id));
}

function overlappingWritePaths(aPaths: readonly string[], bPaths: readonly string[]): string[] {
  const conflicts: string[] = [];

  for (const aPath of aPaths) {
    for (const bPath of bPaths) {
      if (pathsOverlap(aPath, bPath)) {
        conflicts.push(`${aPath} <-> ${bPath}`);
      }
    }
  }

  return conflicts;
}

function pathsOverlap(aPath: string, bPath: string): boolean {
  const a = normalizePath(aPath);
  const b = normalizePath(bPath);
  if (!a || !b) return false;
  if (a === '.' || b === '.') return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function normalizePath(filePath: string): string {
  return filePath
    .replaceAll('\\', '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}
