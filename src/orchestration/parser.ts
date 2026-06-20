import type { ParsedCommandKind } from './types.js';

export type CommandCandidateSource = 'code_block' | 'markdown_line';

export type CommandCandidate = {
  text: string;
  kind: ParsedCommandKind;
  source: CommandCandidateSource;
  order: number;
  startLine: number;
  endLine: number;
  language?: string;
};

const SHELL_LANGUAGES = new Set([
  '',
  'bash',
  'sh',
  'shell',
  'zsh',
  'powershell',
  'ps1',
  'pwsh',
  'cmd',
  'bat',
  'terminal',
  'console',
]);

const COMMAND_START_PATTERN =
  /^(?:npm|pnpm|yarn|bun|node|npx|tsx|tsc|git|gh|docker|make|cmake|bash|sh|pwsh|powershell|python|python3|pip|pip3|go|cargo|dotnet|mvn|gradle|pytest|ruff|eslint|prettier|vitest|jest|deno|kubectl|terraform|az|aws|gcloud)\b/i;

const VALIDATION_PATTERNS: RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|check|typecheck)\b/i,
  /\b(?:test|build|lint|typecheck|validate|verify|check)\b/i,
  /\b(?:tsc|eslint|prettier|vitest|jest|pytest|ruff|go test|cargo test|dotnet test)\b/i,
];

const AGENT_PATTERNS: RegExp[] = [
  /@copilot\b/i,
  /\bcopilot\b/i,
  /\bcoding agent\b/i,
  /\bagent command\b/i,
  /\bask the agent\b/i,
];

const RESEARCH_PATTERNS: RegExp[] = [
  /\b(?:research|investigate|look up|search|read the docs|check docs|documentation)\b/i,
  /\b(?:web|browser)\s+search\b/i,
];

const CONVERSATION_PATTERNS: RegExp[] = [
  /\b(?:ask|confirm|clarify|choose|decide)\b/i,
  /\b(?:user|maintainer|architect|team|reviewer)\b/i,
  /\bshould\s+(?:we|i)\b/i,
  /\?$/,
];

export function classifyCommandCandidate(text: string, language = ''): ParsedCommandKind {
  const trimmed = text.trim();
  const normalizedLanguage = language.trim().toLowerCase();

  if (AGENT_PATTERNS.some(pattern => pattern.test(trimmed))) return 'agent_command';
  if (RESEARCH_PATTERNS.some(pattern => pattern.test(trimmed))) return 'research';
  if (CONVERSATION_PATTERNS.some(pattern => pattern.test(trimmed))) return 'conversation';
  if (VALIDATION_PATTERNS.some(pattern => pattern.test(trimmed))) return 'validation';
  if ((normalizedLanguage && SHELL_LANGUAGES.has(normalizedLanguage)) || COMMAND_START_PATTERN.test(trimmed)) {
    return 'shell_command';
  }

  return 'conversation';
}

export function extractCommandCandidates(markdown: string): CommandCandidate[] {
  const lines = markdown.split(/\r?\n/);
  const candidates: CommandCandidate[] = [];
  let order = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fence = parseFenceStart(line);

    if (fence) {
      const blockStart = index + 1;
      const blockLines: string[] = [];
      index += 1;

      while (index < lines.length && !isFenceEnd(lines[index] ?? '', fence.marker)) {
        blockLines.push(lines[index] ?? '');
        index += 1;
      }

      for (const command of extractCodeBlockCommands(blockLines, fence.language, blockStart)) {
        candidates.push({
          ...command,
          source: 'code_block',
          order,
        });
        order += 1;
      }
      continue;
    }

    for (const command of extractMarkdownLineCommands(line, index + 1)) {
      candidates.push({
        ...command,
        source: 'markdown_line',
        order,
      });
      order += 1;
    }
  }

  return candidates;
}

function parseFenceStart(line: string): { marker: string; language: string } | null {
  const match = line.match(/^\s*(```+|~~~+)\s*([A-Za-z0-9_-]*)?/);
  if (!match) return null;
  return {
    marker: match[1],
    language: match[2]?.toLowerCase() ?? '',
  };
}

function isFenceEnd(line: string, marker: string): boolean {
  return line.trim().startsWith(marker);
}

function extractCodeBlockCommands(
  lines: string[],
  language: string,
  firstLineNumber: number,
): Array<Omit<CommandCandidate, 'source' | 'order'>> {
  const normalizedLanguage = language.trim().toLowerCase();
  if (normalizedLanguage && !SHELL_LANGUAGES.has(normalizedLanguage)) return [];

  const commands: Array<Omit<CommandCandidate, 'source' | 'order'>> = [];

  lines.forEach((line, offset) => {
    const cleaned = cleanCodeCommandLine(line);
    if (!cleaned || !isCandidateText(cleaned, normalizedLanguage || undefined)) return;

    commands.push({
      text: cleaned,
      kind: classifyCommandCandidate(cleaned, normalizedLanguage),
      startLine: firstLineNumber + offset + 1,
      endLine: firstLineNumber + offset + 1,
      language: normalizedLanguage || undefined,
    });
  });

  return commands;
}

function extractMarkdownLineCommands(
  line: string,
  lineNumber: number,
): Array<Omit<CommandCandidate, 'source' | 'order'>> {
  const inlineCommands = [...line.matchAll(/`([^`\n]+)`/g)]
    .map(match => match[1].trim())
    .filter(text => isCandidateText(text));

  if (inlineCommands.length > 0) {
    return inlineCommands.map(text => ({
      text,
      kind: classifyCommandCandidate(text),
      startLine: lineNumber,
      endLine: lineNumber,
    }));
  }

  const cleaned = cleanMarkdownDirective(line);
  if (!cleaned || !isDirectiveLine(cleaned) || !isCandidateText(cleaned)) return [];

  return [{
    text: cleaned,
    kind: classifyCommandCandidate(cleaned),
    startLine: lineNumber,
    endLine: lineNumber,
  }];
}

function cleanCodeCommandLine(line: string): string {
  return line
    .trim()
    .replace(/^PS\s+[^>]+>\s*/i, '')
    .replace(/^[$>]\s+/, '')
    .trim();
}

function cleanMarkdownDirective(line: string): string {
  return line
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^(?:run|execute|validate(?:\s+with)?|verify(?:\s+with)?|check)\s+/i, '')
    .trim();
}

function isDirectiveLine(text: string): boolean {
  return COMMAND_START_PATTERN.test(text)
    || AGENT_PATTERNS.some(pattern => pattern.test(text))
    || RESEARCH_PATTERNS.some(pattern => pattern.test(text))
    || CONVERSATION_PATTERNS.some(pattern => pattern.test(text))
    || VALIDATION_PATTERNS.some(pattern => pattern.test(text));
}

function isCandidateText(text: string, language?: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(?:#|\/\/|\.\.\.)/.test(trimmed)) return false;

  const normalizedLanguage = language?.trim().toLowerCase() ?? '';
  const isTrustedShellContext = Boolean(language) && SHELL_LANGUAGES.has(normalizedLanguage);
  return isTrustedShellContext
    || COMMAND_START_PATTERN.test(trimmed)
    || AGENT_PATTERNS.some(pattern => pattern.test(trimmed))
    || RESEARCH_PATTERNS.some(pattern => pattern.test(trimmed))
    || CONVERSATION_PATTERNS.some(pattern => pattern.test(trimmed))
    || VALIDATION_PATTERNS.some(pattern => pattern.test(trimmed));
}
