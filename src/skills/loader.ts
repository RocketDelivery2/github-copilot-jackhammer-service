import { readFile } from 'node:fs/promises';
import type { SkillDocument, SkillMetadata, SkillRisk } from './types.js';

type ParsedFrontMatter = Record<string, string | string[]>;

const VALID_RISKS: readonly SkillRisk[] = ['low', 'medium', 'high'];

export async function loadSkillMetadataFromFile(filePath: string): Promise<SkillMetadata> {
  const markdown = await readFile(filePath, 'utf8');
  return parseSkillMetadata(markdown, filePath);
}

export async function loadSkillDocumentFromFile(filePath: string): Promise<SkillDocument> {
  const markdown = await readFile(filePath, 'utf8');
  return parseSkillDocument(markdown, filePath);
}

export function parseSkillMetadata(markdown: string, skillPath?: string): SkillMetadata {
  const { frontMatter } = extractFrontMatter(markdown);
  const parsed = parseFrontMatter(frontMatter);
  return coerceSkillMetadata(parsed, skillPath);
}

export function parseSkillDocument(markdown: string, skillPath?: string): SkillDocument {
  const { frontMatter, body } = extractFrontMatter(markdown);
  const parsed = parseFrontMatter(frontMatter);
  return {
    metadata: coerceSkillMetadata(parsed, skillPath),
    body: body.trim(),
  };
}

function extractFrontMatter(markdown: string): { frontMatter: string; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Skill markdown must include YAML front matter bounded by --- markers.');
  }
  return {
    frontMatter: match[1],
    body: match[2] ?? '',
  };
}

function parseFrontMatter(frontMatter: string): ParsedFrontMatter {
  const lines = frontMatter.split(/\r?\n/);
  const parsed: ParsedFrontMatter = {};

  let currentListKey: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      const existing = parsed[currentListKey];
      if (!Array.isArray(existing)) {
        parsed[currentListKey] = [];
      }
      (parsed[currentListKey] as string[]).push(stripQuotes(listMatch[1].trim()));
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!keyMatch) {
      throw new Error(`Invalid front matter line: "${line}"`);
    }

    const key = keyMatch[1];
    const rawValue = keyMatch[2].trim();
    if (rawValue.length === 0) {
      parsed[key] = [];
      currentListKey = key;
      continue;
    }

    parsed[key] = parseScalarOrInlineList(rawValue);
    currentListKey = undefined;
  }

  return parsed;
}

function parseScalarOrInlineList(rawValue: string): string | string[] {
  const inlineList = rawValue.match(/^\[(.*)\]$/);
  if (!inlineList) {
    return stripQuotes(rawValue);
  }

  const contents = inlineList[1].trim();
  if (contents.length === 0) {
    return [];
  }

  return contents.split(',').map(entry => stripQuotes(entry.trim())).filter(Boolean);
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1);
  }
  return value;
}

function coerceSkillMetadata(parsed: ParsedFrontMatter, skillPath?: string): SkillMetadata {
  const name = requireString(parsed.name, 'name');
  const description = requireString(parsed.description, 'description');
  const version = optionalString(parsed.version, '1.0.0');
  const risk = optionalString(parsed.risk, 'medium');

  if (!VALID_RISKS.includes(risk as SkillRisk)) {
    throw new Error(`Invalid skill risk "${risk}". Expected one of: ${VALID_RISKS.join(', ')}`);
  }

  return {
    name,
    description,
    version,
    risk: risk as SkillRisk,
    allowedTools: toStringArray(parsed.allowedTools),
    resourceHints: toStringArray(parsed.resourceHints),
    keywords: toStringArray(parsed.keywords),
    skillPath,
  };
}

function requireString(value: string | string[] | undefined, field: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error(`Skill front matter requires a non-empty "${field}" field.`);
}

function optionalString(value: string | string[] | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map(entry => entry.trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}
