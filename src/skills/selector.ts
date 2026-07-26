import type { SkillMatch, SkillMetadataIndex, SkillSearchEntry, SkillTaskLike } from './types.js';
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
  const matches = index.searchEntries
    .map(entry => scoreSkill(entry, text))
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

function scoreSkill(entry: SkillSearchEntry, taskText: string): SkillMatch {
  let score = 0;
  const reasons: string[] = [];

  if (containsNormalizedPhrase(taskText, entry.normalizedName)) {
    score += 6;
    reasons.push(`name:${entry.skill.name}`);
  }

  for (const keyword of entry.normalizedKeywords) {
    if (containsNormalizedPhrase(taskText, keyword)) {
      score += 4;
      reasons.push(`keyword:${keyword}`);
    }
  }

  for (const token of entry.normalizedDescriptionTokens) {
    if (containsNormalizedPhrase(taskText, token)) {
      score += 2;
      reasons.push(`description:${token}`);
    }
  }

  for (const tool of entry.normalizedAllowedTools) {
    if (containsNormalizedPhrase(taskText, tool)) {
      score += 1;
      reasons.push(`tool:${tool}`);
    }
  }

  return { skill: entry.skill, score, reasons };
}

function normalizeTaskText(task: SkillTaskLike): string {
  return [task.title ?? '', task.summary ?? '', task.description ?? '', task.command ?? '']
    .join(' ')
    .toLowerCase();
}

function containsNormalizedPhrase(haystack: string, phrase: string): boolean {
  return phrase.length > 0 && haystack.includes(phrase);
}
