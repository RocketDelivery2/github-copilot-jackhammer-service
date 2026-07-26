import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { rebalanceQueue } from '../../src/brain.ts';
import { mapRuntimeInputsToWorkItems } from '../../src/orchestration/adapter.ts';
import { scoreWorkItem } from '../../src/orchestration/rebalance.ts';

function benchmark(name, iterations, fn) {
  for (let i = 0; i < 20; i += 1) {
    fn();
  }

  const startedAt = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  const elapsedMs = performance.now() - startedAt;
  console.log(`${name.padEnd(46)} ${elapsedMs.toFixed(2)} ms (${iterations} iters)`);
  return elapsedMs;
}

function makeQueueItem(index) {
  return {
    hash: `h-${index}`,
    title: index % 13 === 0 ? `Fix build path ${index}` : `Feature task ${index}`,
    priority: index % 5 === 0 ? 'high' : index % 3 === 0 ? 'medium' : 'low',
    prompt: index % 7 === 0 ? `Run test gate ${index}` : `Implement task ${index}`,
  };
}

function legacyRebalanceQueue(queue, signals) {
  const recommendedTitle = signals.guidance?.recommendedNextPR?.toLowerCase() ?? null;
  const blockers = signals.guidance?.blockers.map(blocker => blocker.toLowerCase()) ?? [];
  const { failedChecks, hasBuildIssue, hasLintIssue } = signals;

  function scoreItem(item) {
    const title = item.title.toLowerCase();
    const prompt = item.prompt.toLowerCase();
    if (recommendedTitle && (title.includes(recommendedTitle) || recommendedTitle.includes(title))) return -1000;
    if (blockers.some(blocker => title.includes(blocker) || prompt.includes(blocker))) return 1000;

    let score = 0;
    if (hasBuildIssue && (title.includes('build') || prompt.includes('build'))) score -= 50;
    if (hasLintIssue && (title.includes('lint') || prompt.includes('lint'))) score -= 40;
    if (failedChecks && (title.includes('test') || prompt.includes('test'))) score -= 30;
    if (item.priority === 'high') score -= 20;
    else if (item.priority === 'medium') score -= 10;
    return score;
  }

  return [...queue].sort((left, right) => scoreItem(left) - scoreItem(right));
}

function benchmarkQueueRebalance() {
  const queue = Array.from({ length: 5_000 }, (_, index) => makeQueueItem(index));
  const signals = {
    guidance: { recommendedNextPR: null, blockers: [] },
    failedChecks: true,
    hasTests: true,
    hasBuildIssue: true,
    hasLintIssue: true,
    isProductionReady: false,
  };

  const legacy = legacyRebalanceQueue(queue, signals);
  const current = rebalanceQueue(queue, signals);
  assert.deepEqual(current.map(item => item.hash), legacy.map(item => item.hash));

  const legacyMs = benchmark('rebalanceQueue legacy comparator scoring', 40, () => {
    legacyRebalanceQueue(queue, signals);
  });
  const currentMs = benchmark('rebalanceQueue precomputed scoring', 40, () => {
    rebalanceQueue(queue, signals);
  });
  return { legacyMs, currentMs };
}

function makeRuntimeInputs(size) {
  const commandQueue = [];
  for (let i = 0; i < size; i += 1) {
    const issueNumber = Math.floor(i / 2);
    commandQueue.push({
      hash: `q-${i}`,
      title: `Queue item ${i}`,
      priority: i % 4 === 0 ? 'high' : i % 3 === 0 ? 'medium' : 'low',
      issueNumber,
      issueUrl: `https://github.example/issues/${issueNumber}`,
      prompt: `Prompt ${i}`,
    });
  }

  return {
    activeWorkItem: {
      issueNumber: 0,
      issueUrl: 'https://github.example/issues/0',
      title: 'Active work item',
      startedAt: '2026-06-20T12:00:00.000Z',
    },
    commandQueue,
  };
}

function legacyMapRuntimeInputsToWorkItems(inputs) {
  const workItems = [];
  if (inputs.activeWorkItem) {
    workItems.push({
      id: `issue:${inputs.activeWorkItem.issueNumber}`,
      title: inputs.activeWorkItem.title,
      kind: 'agent_command',
      status: 'running',
      priority: 'high',
      description: inputs.activeWorkItem.issueUrl,
      writePaths: [],
    });
  }

  for (const item of inputs.commandQueue ?? []) {
    const mapped = {
      id: item.issueNumber ? `issue:${item.issueNumber}` : `queue:${item.hash}`,
      title: item.title,
      kind: 'agent_command',
      status: 'pending',
      priority: item.priority,
      description: item.prompt,
      writePaths: [],
    };
    if (!workItems.some(existing => existing.id === mapped.id)) {
      workItems.push(mapped);
    }
  }

  return workItems;
}

function benchmarkRuntimeMapping() {
  const inputs = makeRuntimeInputs(20_000);
  const legacy = legacyMapRuntimeInputsToWorkItems(inputs);
  const current = mapRuntimeInputsToWorkItems(inputs);
  assert.deepEqual(current.map(item => item.id), legacy.map(item => item.id));

  const legacyMs = benchmark('mapRuntimeInputsToWorkItems legacy dedupe', 50, () => {
    legacyMapRuntimeInputsToWorkItems(inputs);
  });
  const currentMs = benchmark('mapRuntimeInputsToWorkItems Set dedupe', 50, () => {
    mapRuntimeInputsToWorkItems(inputs);
  });
  return { legacyMs, currentMs };
}

function legacySortByScore(items, context) {
  const originalOrder = new Map(items.map((item, index) => [item.id, index]));
  return [...items].sort((left, right) => {
    const scoreDiff = scoreWorkItem(right, context) - scoreWorkItem(left, context);
    if (scoreDiff !== 0) return scoreDiff;
    return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
  });
}

function precomputedSortByScore(items, context) {
  const originalOrder = new Map(items.map((item, index) => [item.id, index]));
  const scores = new Map(items.map(item => [item.id, scoreWorkItem(item, context)]));
  return [...items].sort((left, right) => {
    const scoreDiff = (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
  });
}

function benchmarkRebalanceSortStage() {
  const items = Array.from({ length: 6_000 }, (_, index) => ({
    id: `item-${index}`,
    title: `Work item ${index}`,
    kind: index % 5 === 0 ? 'fix' : 'feature',
    status: index % 17 === 0 ? 'completed' : 'pending',
    priority: index % 7 === 0 ? 'urgent' : index % 3 === 0 ? 'high' : 'medium',
    dependsOn: index > 0 && index % 9 === 0 ? [`item-${index - 1}`] : [],
  }));
  const signals = Array.from({ length: 300 }, (_, index) => ({
    kind: index % 2 === 0 ? 'urgent' : 'blocker',
    severity: index % 2 === 0 ? 'warning' : 'error',
    message: `Signal ${index}`,
    targetItemId: `item-${index * 3}`,
  }));
  const completedIds = new Set(items.filter(item => item.status === 'completed').map(item => item.id));
  const context = { signals, completedIds, hasActiveFailure: true };

  const legacy = legacySortByScore(items, context);
  const current = precomputedSortByScore(items, context);
  assert.deepEqual(current.map(item => item.id), legacy.map(item => item.id));

  const legacyMs = benchmark('rebalance sort stage legacy scoring calls', 30, () => {
    legacySortByScore(items, context);
  });
  const currentMs = benchmark('rebalance sort stage precomputed scores', 30, () => {
    precomputedSortByScore(items, context);
  });
  return { legacyMs, currentMs };
}

function speedup(before, after) {
  return `${(before / after).toFixed(2)}x`;
}

const rebalanceQueueResults = benchmarkQueueRebalance();
const runtimeMappingResults = benchmarkRuntimeMapping();
const rebalanceSortResults = benchmarkRebalanceSortStage();

console.log('');
console.log('Summary');
console.log(`- rebalanceQueue: ${speedup(rebalanceQueueResults.legacyMs, rebalanceQueueResults.currentMs)} faster`);
console.log(`- mapRuntimeInputsToWorkItems: ${speedup(runtimeMappingResults.legacyMs, runtimeMappingResults.currentMs)} faster`);
console.log(`- rebalance sort stage: ${speedup(rebalanceSortResults.legacyMs, rebalanceSortResults.currentMs)} faster`);
