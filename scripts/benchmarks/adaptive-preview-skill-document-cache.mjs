import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { buildAdaptivePreviewSkillExecutionPlans } from '../../src/orchestration/adapter.ts';
import { buildSkillExecutionPlan } from '../../src/skills/execution-plan.ts';
import { createSkillMetadataIndex } from '../../src/skills/registry.ts';
import { parseSkillDocument } from '../../src/skills/loader.ts';

const repoRoot = process.cwd();
const skillRelativePath = 'skills/validation/skill.md';
const skillAbsolutePath = path.resolve(repoRoot, skillRelativePath);

const markdown = await readFile(skillAbsolutePath, 'utf8');
const skillIndex = createSkillMetadataIndex([{
  skillPath: skillRelativePath,
  markdown,
}]);

const skillSelections = Array.from({ length: 40 }, (_, index) => ({
  taskId: `task:${index + 1}`,
  skillName: 'validation',
  rank: index + 1,
  score: 8,
  reasons: ['keyword:validation'],
  risk: 'low',
  allowedTools: ['npm.cmd'],
  trustPolicySummary: {
    instructionsReadAllowed: true,
    referencesReadAllowed: true,
    assetsReadAllowed: true,
    scriptsRequireHumanApproval: true,
    scriptsAutoExecutable: false,
  },
}));

async function loadSkillDocument(filePath) {
  const contents = await readFile(path.resolve(repoRoot, filePath), 'utf8');
  return parseSkillDocument(contents, filePath);
}

async function buildAdaptivePreviewSkillExecutionPlansLegacy(options) {
  if (!options.enabled) {
    return [];
  }

  const maxPlans = Math.max(0, Math.floor(options.maxPlans ?? 8));
  const maxStepsPerPlan = Math.max(1, Math.floor(options.maxStepsPerPlan ?? 6));
  if (maxPlans === 0) {
    return [];
  }

  const loadDocument = options.loadSkillDocument ?? loadSkillDocument;
  const plans = [];
  for (const selection of options.skillSelections.slice(0, maxPlans)) {
    const metadata = options.skillIndex.skills.find(skill => skill.name === selection.skillName);
    if (!metadata?.skillPath) {
      continue;
    }

    const document = await loadDocument(metadata.skillPath);
    plans.push(buildSkillExecutionPlan({
      taskId: selection.taskId,
      skillName: selection.skillName,
      selectionRank: selection.rank,
      selectionScore: selection.score,
      selectionReasons: selection.reasons,
      risk: selection.risk,
      allowedTools: selection.allowedTools,
      document,
      maxSteps: maxStepsPerPlan,
      trustPolicySummary: {
        instructionsReadAllowed: selection.trustPolicySummary.instructionsReadAllowed,
        referencesReadAllowed: selection.trustPolicySummary.referencesReadAllowed,
        assetsReadAllowed: selection.trustPolicySummary.assetsReadAllowed,
        scriptsRequireHumanApproval: selection.trustPolicySummary.scriptsRequireHumanApproval,
        scriptsAutoExecutable: selection.trustPolicySummary.scriptsAutoExecutable,
        scriptExecutionBlocked: true,
      },
    }));
  }

  return plans;
}

async function measure(label, callback, iterations) {
  const started = performance.now();
  let lastResult;
  for (let index = 0; index < iterations; index += 1) {
    lastResult = await callback();
  }
  return {
    label,
    durationMs: performance.now() - started,
    lastResult,
  };
}

let loadCalls = 0;
const trackedLoadSkillDocument = async (filePath) => {
  loadCalls += 1;
  return loadSkillDocument(filePath);
};

const runOptions = {
  enabled: true,
  skillSelections,
  skillIndex,
  maxPlans: skillSelections.length,
  maxStepsPerPlan: 2,
  loadSkillDocument: trackedLoadSkillDocument,
};

const memoizedPreview = await buildAdaptivePreviewSkillExecutionPlans(runOptions);
loadCalls = 0;
const legacyPreview = await buildAdaptivePreviewSkillExecutionPlansLegacy(runOptions);

assert.deepEqual(memoizedPreview, legacyPreview);

const iterations = 25;

loadCalls = 0;
const memoized = await measure('memoized', () => buildAdaptivePreviewSkillExecutionPlans(runOptions), iterations);
const memoizedLoadCalls = loadCalls;

loadCalls = 0;
const legacy = await measure('legacy', () => buildAdaptivePreviewSkillExecutionPlansLegacy(runOptions), iterations);
const legacyLoadCalls = loadCalls;

const speedup = legacy.durationMs / memoized.durationMs;

console.log(`Adaptive preview skill document cache benchmark (${iterations} iterations)`);
console.log(`memoized: ${memoized.durationMs.toFixed(2)} ms total, ${memoizedLoadCalls} document loads`);
console.log(`legacy:   ${legacy.durationMs.toFixed(2)} ms total, ${legacyLoadCalls} document loads`);
console.log(`speedup:  ${speedup.toFixed(2)}x`);
