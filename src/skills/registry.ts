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

  return {
    skills,
    generatedAt: (options.now ?? (() => new Date().toISOString()))(),
  };
}

export function getSkillByName(index: SkillMetadataIndex, name: string): SkillMetadata | undefined {
  return index.skills.find(skill => skill.name === name);
}
