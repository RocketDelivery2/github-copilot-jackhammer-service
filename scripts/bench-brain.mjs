import { performance } from 'node:perf_hooks';
import { rebalanceQueue } from '../src/brain.ts';

const iterations = Number(process.env.BENCH_ITERATIONS ?? 300);
const itemCount = Number(process.env.BENCH_ITEMS ?? 400);

const guidance = {
  recommendedNextPR: null,
  planSteps: [],
  notes: [],
  validation: [],
  blockers: [],
  errors: [],
  hasCopilotQuestion: false,
  rawText: '',
  extractedAt: new Date().toISOString(),
};

const signals = {
  guidance,
  failedChecks: true,
  hasTests: true,
  hasBuildIssue: true,
  hasLintIssue: true,
  isProductionReady: false,
};

const queue = Array.from({ length: itemCount }, (_, index) => ({
  hash: String(index).padStart(8, '0'),
  title: index % 10 === 0 ? 'Fix build blockers' : `Task ${index}`,
  priority: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low',
  prompt: index % 10 === 0 ? 'Fix build and test failures' : `Implement feature ${index}`,
}));

const start = performance.now();
for (let iteration = 0; iteration < iterations; iteration += 1) {
  rebalanceQueue(queue, signals);
}
const elapsed = performance.now() - start;

console.log(JSON.stringify({
  iterations,
  items: itemCount,
  ms: Math.round(elapsed),
  perIteration: Math.round((elapsed / iterations) * 100) / 100
}));
