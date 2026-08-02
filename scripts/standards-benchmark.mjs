import { performance } from 'node:perf_hooks';
import { assessTaskByIndustryStandards, rankCommandsByIndustryStandards } from '../src/standards.js';

function makeTask(index, overrides = {}) {
  const topic = [
    `Task ${index} title placeholder for queue ranking`,
    `Implement a scoped change with verification steps for area ${index}.`,
    `Make a small, reviewable change and include tests for area ${index}.`,
    `Behavior is correct and validated with no regressions for area ${index}.`,
    `Run relevant tests, build checks, and lint for area ${index}.`,
  ].join(' ');

  return {
    title: `Task ${index}: ${topic}`,
    priority: 'medium',
    type: index % 4 === 0 ? 'maintenance' : index % 4 === 1 ? 'bug' : index % 4 === 2 ? 'feature' : 'docs',
    summary: `Summary ${index}: ${topic}`,
    target_files: [
      'src/index.ts',
      'src/standards.ts',
      'src/orchestration/adapter.ts',
    ],
    copilot_prompt: `Prompt ${index}: ${topic} Focus on bounded cache hits and deterministic ranking.`,
    acceptance_criteria: [
      `Criterion ${index}: behavior stays identical.`,
      `Criterion ${index}: regression coverage remains green.`,
    ],
    test_plan: [
      `npm test for scenario ${index}`,
      `npm run build for scenario ${index}`,
    ],
    risk_notes: [
      `Risk ${index}: keep memory bounded and behavior unchanged.`,
    ],
    ...overrides,
  };
}

function makeSnapshot() {
  return {
    owner: 'RocketDelivery2',
    repo: 'github-copilot-jackhammer-service',
    baseBranch: 'main',
    commitSha: 'benchmark',
    generatedAt: '2026-07-26T00:00:00.000Z',
    fileCount: 2,
    files: [{ path: 'README.md', bytes: 10, content: 'example' }],
    recentChanges: 'hotfix: failing build and failing tests in API service with rollback discussion and regression follow-up',
    packageHints: ['CI pipeline failing', 'production error', 'rollback plan', 'api outage'],
  };
}

function buildWorkload() {
  return {
    tasks: Array.from({ length: 24 }, (_, index) => makeTask(index)),
    snapshot: makeSnapshot(),
  };
}

function measure(label, fn) {
  const started = performance.now();
  const value = fn();
  return {
    label,
    ms: performance.now() - started,
    value,
  };
}

function runRanking(tasks, snapshot, iterations) {
  let checksum = 0;
  for (let i = 0; i < iterations; i += 1) {
    const ranked = rankCommandsByIndustryStandards(tasks, snapshot);
    checksum += ranked[0]?.assessment.score ?? 0;
    checksum += ranked[ranked.length - 1]?.assessment.score ?? 0;
  }
  return checksum;
}

function main() {
  const iterations = 400;

  const coldWorkloads = Array.from({ length: iterations }, () => buildWorkload());
  const warmWorkload = buildWorkload();

  const cold = measure('cold', () => {
    let checksum = 0;
    for (const workload of coldWorkloads) {
      checksum += runRanking(workload.tasks, workload.snapshot, 1);
    }
    return checksum;
  });

  const warm = measure('warm', () => runRanking(warmWorkload.tasks, warmWorkload.snapshot, iterations));
  const sampleAssessment = assessTaskByIndustryStandards(warmWorkload.tasks[0], warmWorkload.snapshot);

  console.log([
    `standards ranking benchmark`,
    `iterations=${iterations}`,
    `tasks-per-run=${warmWorkload.tasks.length}`,
    `cold-ms=${cold.ms.toFixed(2)}`,
    `warm-ms=${warm.ms.toFixed(2)}`,
    `speedup=${(cold.ms / warm.ms).toFixed(2)}x`,
    `checksum=${cold.value + warm.value + sampleAssessment.score}`,
  ].join('\n'));
}

main();
