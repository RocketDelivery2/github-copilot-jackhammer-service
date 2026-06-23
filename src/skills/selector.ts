import type { SkillMatch, SkillMetadata, SkillMetadataIndex, SkillTaskLike } from './types.js';
import { getSkillByName } from './registry.js';

export type SkillSelectionOptions = {
  limit?: number;
  fallbackSkillName?: string;
};

export function selectSkillsForTask(
  index: SkillMetadataIndex,
  task: SkillTaskLike,
  options: SkillSelectionOptions = {},
): SkillMatch[] {
  const text = normalizeTaskText(task);
  const matches = index.skills
    .map(skill => scoreSkill(skill, text))
    .filter((entry): entry is SkillMatch => entry.score > 0)
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

  if (!options.fallbackSkillName) {
    return [];
  }

  const fallback = getSkillByName(index, options.fallbackSkillName);
  if (!fallback) {
    return [];
  }

  return [{
    skill: fallback,
    score: 0,
    reasons: ['fallback'],
  }];
}

function scoreSkill(skill: SkillMetadata, taskText: string): SkillMatch {
  let score = 0;
  const reasons: string[] = [];

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

function normalizeTaskText(task: SkillTaskLike): string {
  return [task.title ?? '', task.summary ?? '', task.description ?? '', task.command ?? '']
    .join(' ')
    .toLowerCase();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = phrase.trim().toLowerCase();
  return needle.length > 0 && haystack.includes(needle);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 4);
}
