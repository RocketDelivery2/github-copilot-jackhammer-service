import { rebalanceWorkItems } from '../src/orchestration/rebalance.js';

function buildWorkItem(index) {
  return {
    id: `item-${index}`,
    title: `Item ${index}`,
    kind: index % 7 === 0
      ? 'feature'
      : index % 7 === 1
        ? 'refactor'
        : index % 7 === 2
          ? 'docs'
          : index % 7 === 3
            ? 'maintenance'
            : index % 7 === 4
              ? 'validation'
              : index % 7 === 5
                ? 'shell_command'
                : 'agent_command',
    status: index % 13 === 0 ? 'running' : 'pending',
    priority: index % 11 === 0 ? 'urgent' : index % 11 === 1 ? 'high' : 'medium',
    description: `Item ${index} description`,
    dependsOn: index % 9 === 0 ? [`item-${Math.max(0, index - 1)}`] : undefined,
    readPaths: [`src/module-${index % 20}`, `docs/${index % 5}`],
    writePaths: [`src/module-${index % 20}`, `docs/${index % 5}`],
    worktree: `.worktrees/item-${index}`,
  };
}

const workItems = Array.from({ length: 200 }, (_, index) => buildWorkItem(index));
const signals = [
  { kind: 'build_failure', severity: 'error', message: 'Build failed.', workItemId: 'item-7' },
  { kind: 'urgent', severity: 'warning', message: 'Handle this first.', targetItemId: 'item-42' },
  { kind: 'agent_question', severity: 'warning', message: 'Please clarify.', workItemId: 'item-99' },
];
const events = [
  { workItemId: 'item-7', kind: 'stderr', stderr: 'error TS1234: failed' },
  { workItemId: 'item-9', kind: 'stderr', stderr: 'ESLint found 2 errors' },
];

for (let i = 0; i < 100; i++) rebalanceWorkItems(workItems, events, signals);

const iterations = Number(process.env.BENCH_ITERATIONS ?? 5000);
const started = process.hrtime.bigint();

for (let i = 0; i < iterations; i++) {
  rebalanceWorkItems(workItems, events, signals);
}

const durationMs = Number(process.hrtime.bigint() - started) / 1e6;

console.log(JSON.stringify({
  iterations,
  durationMs,
  perOpMs: durationMs / iterations,
  workItems: workItems.length,
  signals: signals.length,
  events: events.length,
}));
