import type { SkillMetadata, SkillMetadataIndex } from './types.js';
import { parseSkillMetadata } from './loader.js';

export type SkillSource = {
  skillPath: string;
  markdown: string;
};

export function createSkillMetadataIndex(
  sources: readonly SkillSource[],
  options: { now?: () => string } = {},
): SkillMetadataIndex {
  const skills = sources
    .map(source => parseSkillMetadata(source.markdown, source.skillPath))
    .sort((left, right) => left.name.localeCompare(right.name));
  const searchEntries = skills.map(skill => ({
    skill,
    normalizedName: normalizeSearchTerm(skill.name),
    normalizedKeywords: skill.keywords.map(normalizeSearchTerm).filter(term => term.length > 0),
    normalizedDescriptionTokens: tokenizeSearchText(skill.description),
    normalizedAllowedTools: skill.allowedTools.map(normalizeSearchTerm).filter(term => term.length > 0),
  }));

  return {
    skills,
    searchEntries,
    generatedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
}

export function getSkillByName(index: SkillMetadataIndex, name: string): SkillMetadata | undefined {
  return index.skills.find(skill => skill.name === name);
}

function normalizeSearchTerm(value: string): string {
  return value.trim().toLowerCase();
}

function tokenizeSearchText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 4);
}
