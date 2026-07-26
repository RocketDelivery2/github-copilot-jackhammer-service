import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createSkillMetadataIndex } from '../../src/skills/registry.js';
import { selectSkillsForTask } from '../../src/skills/selector.js';

const ROOT_DIR = process.cwd();
const SKILLS_DIR = path.join(ROOT_DIR, 'skills');

async function readSkillSources() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  const sources = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(SKILLS_DIR, entry.name, 'skill.md');
    const markdown = await readFile(skillPath, 'utf8');
    sources.push({
      skillPath: path.relative(ROOT_DIR, skillPath),
      markdown,
    });
  }

  return sources;
}

function normalizeTaskText(task) {
  return [task.title ?? '', task.summary ?? '', task.description ?? '', task.command ?? '']
    .join(' ')
    .toLowerCase();
}

function containsPhrase(haystack, phrase) {
  const needle = phrase.trim().toLowerCase();
  return needle.length > 0 && haystack.includes(needle);
}

function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 4);
}

function scoreLegacySkill(skill, taskText) {
  let score = 0;
  const reasons = [];

  if (containsPhrase(taskText, skill.name)) {
    score += 6;
    reasons.push(`name:${skill.name}`);
  }

  for (const keyword of skill.keywords) {
    if (containsPhrase(taskText, keyword)) {
      score += 4;
      reasons.push(`keyword:${keyword}`);
    }
  }

  for (const token of tokenize(skill.description)) {
    if (containsPhrase(taskText, token)) {
      score += 2;
      reasons.push(`description:${token}`);
    }
  }

  for (const tool of skill.allowedTools) {
    if (containsPhrase(taskText, tool)) {
      score += 1;
      reasons.push(`tool:${tool}`);
    }
  }

  return { skill, score, reasons };
}

function selectLegacySkillsForTask(index, task, limit = 5) {
  const text = normalizeTaskText(task);
  const matches = index.skills
    .map(skill => scoreLegacySkill(skill, text))
    .filter(entry => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.skill.name.localeCompare(right.skill.name);
    });

  return matches.slice(0, Math.max(1, Math.floor(limit)));
}

function selectOptimizedSkillsForTask(index, task, limit = 5) {
  return selectSkillsForTask(index, task, { limit });
}

function makeExpandedIndex(index, copies) {
  const skills = [];
  const searchEntries = [];

  for (let i = 0; i < copies; i += 1) {
    for (let j = 0; j < index.skills.length; j += 1) {
      skills.push(index.skills[j]);
      searchEntries.push(index.searchEntries[j]);
    }
  }

  return {
    skills,
    searchEntries,
    generatedAt: index.generatedAt,
  };
}

function runBenchmark(label, fn, iterations) {
  for (let i = 0; i < 50; i += 1) {
    fn();
  }

  const start = performance.now();
  let checksum = 0;
  for (let i = 0; i < iterations; i += 1) {
    checksum += fn().length;
  }
  const elapsed = performance.now() - start;

  return {
    label,
    iterations,
    elapsedMs: elapsed,
    checksum,
  };
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

async function main() {
  const baseIndex = createSkillMetadataIndex(await readSkillSources());
  const benchmarkIndex = makeExpandedIndex(baseIndex, 96);
  const task = {
    title: 'Coordinate unrelated repository maintenance work',
    summary: 'No skill should match this synthetic workload.',
    description: 'This benchmark intentionally avoids any skill-specific keywords.',
    command: 'maintenance',
  };

  const legacy = runBenchmark(
    'legacy',
    () => selectLegacySkillsForTask(benchmarkIndex, task, 5),
    1200,
  );
  const optimized = runBenchmark(
    'optimized',
    () => selectOptimizedSkillsForTask(benchmarkIndex, task, 5),
    1200,
  );

  const ratio = legacy.elapsedMs / optimized.elapsedMs;

  console.log('Skill selector hotspot benchmark');
  console.log(`Skills in benchmark index: ${benchmarkIndex.skills.length}`);
  console.log(`Legacy selector: ${formatMs(legacy.elapsedMs)} (${legacy.iterations} iters, checksum=${legacy.checksum})`);
  console.log(`Optimized selector: ${formatMs(optimized.elapsedMs)} (${optimized.iterations} iters, checksum=${optimized.checksum})`);
  console.log(`Speedup: ${ratio.toFixed(2)}x`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
