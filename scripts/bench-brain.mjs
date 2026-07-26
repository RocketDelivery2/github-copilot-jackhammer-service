import { performance } from 'node:perf_hooks';
import { rebalanceQueue } from '../src/brain.ts';

const rounds = Number.parseInt(process.env.BENCH_ROUNDS ?? '1500', 10);
const queueSize = Number.parseInt(process.env.BENCH_QUEUE_SIZE ?? '400', 10);

const queue = Array.from({ length: queueSize }, (_, index) => ({
  hash: `task-${index}`,
  title: `${index % 3 === 0 ? 'Fix Build Error' : index % 3 === 1 ? 'Add Docs' : 'Run tests'} ${index}`,
  priority: index % 5 === 0 ? 'high' : index % 5 === 1 ? 'medium' : 'low',
  prompt: `${index % 4 === 0 ? 'Investigate build failure' : 'Implement feature'} ${index}`,
}));

const signals = {
  guidance: {
    recommendedNextPR: 'Fix Build Error 63',
    planSteps: [],
    notes: [],
    validation: [],
    blockers: ['add docs 14', 'run tests 9'],
    errors: [],
    hasCopilotQuestion: false,
    rawText: '',
    extractedAt: new Date().toISOString(),
  },
  failedChecks: true,
  hasTests: true,
  hasBuildIssue: true,
  hasLintIssue: true,
  isProductionReady: false,
};

for (let i = 0; i < 50; i += 1) {
  rebalanceQueue(queue, signals);
}

const started = performance.now();
for (let i = 0; i < rounds; i += 1) {
  rebalanceQueue(queue, signals);
}
const elapsed = performance.now() - started;

console.log(JSON.stringify({
  rounds,
  queueSize,
  totalMs: elapsed,
  perCallUs: (elapsed * 1000) / rounds,
}));
