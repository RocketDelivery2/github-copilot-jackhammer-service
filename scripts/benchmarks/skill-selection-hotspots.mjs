import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createSkillMetadataIndex } from '../../src/skills/registry.ts';
import { selectSkillsForTask } from '../../src/skills/selector.ts';

const ITERATIONS = 1_000;
const WARMUP = 50;

function buildIndex(skillCount) {
  const entries = [];

  for (let index = 0; index < skillCount; index += 1) {
    entries.push({
      skillPath: `skills/skill-${index}/skill.md`,
      markdown: `---\nname: skill-${index}\ndescription: Skill ${index} helper for build test lint validation.\nversion: 1.0.0\nrisk: low\nallowedTools: [npm.cmd]\nresourceHints: [src/]\nkeywords: [skill-${index}, validation, build, test, lint]\n---\n`,
    });
  }

  return createSkillMetadataIndex(entries);
}

function normalizeTaskText(task) {
  return `${task.title ?? ''} ${task.summary ?? ''} ${task.description ?? ''} ${task.command ?? ''}`
    .trim()
    .toLowerCase();
}

function containsPhrase(haystack, phrase) {
  const needle = phrase.trim().toLowerCase();
  return needle.length > 0 && haystack.includes(needle);
}

function tokenizeLegacy(text) {
  const tokens = [];
  for (const token of text.toLowerCase().split(/[^a-z0-9-]+/g)) {
    const trimmed = token.trim();
    if (trimmed.length >= 4) {
      tokens.push(trimmed);
    }
  }
  return tokens;
}

function scoreSkillLegacy(skill, taskText) {
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

  for (const token of tokenizeLegacy(skill.description)) {
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

function selectSkillsForTaskLegacy(index, task, options = {}) {
  const text = normalizeTaskText(task);
  const matches = index.skills
    .map(skill => scoreSkillLegacy(skill, text))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.skill.name.localeCompare(right.skill.name);
    });

  const limit = Math.max(1, Math.floor(options.limit ?? 5));
  if (matches.length > 0) {
    return matches.slice(0, limit);
  }

  return [];
}

function benchmark(label, fn) {
  for (let iteration = 0; iteration < WARMUP; iteration += 1) {
    fn();
  }

  let checksum = 0;
  const startedAt = performance.now();

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    checksum += fn().length;
  }

  return {
    label,
    elapsedMs: performance.now() - startedAt,
    checksum,
  };
}

function main() {
  const index = buildIndex(300);
  const task = {
    title: Array.from({ length: 120 }, (_, index) => `skill-${index}`).join(' '),
    summary: 'validation build test lint',
    description: 'Need a deterministic validation skill ranking.',
  };

  const legacy = selectSkillsForTaskLegacy(index, task, { limit: 40 });
  const optimized = selectSkillsForTask(index, task, { limit: 40 });

  assert.deepEqual(
    legacy.map(match => match.skill.name),
    optimized.map(match => match.skill.name),
  );

  const results = [
    benchmark('legacy map/filter selection', () => selectSkillsForTaskLegacy(index, task, { limit: 40 })),
    benchmark('optimized single-pass selection', () => selectSkillsForTask(index, task, { limit: 40 })),
  ];

  for (const result of results) {
    console.log(`${result.label}: ${result.elapsedMs.toFixed(2)} ms (${ITERATIONS} iters, checksum ${result.checksum})`);
  }
}

main();
