import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type AlgorithmPatternId =
  | 'nested_loop'
  | 'array_includes_in_loop'
  | 'array_find_in_loop'
  | 'array_filter_in_loop';

export interface AlgorithmFinding {
  id: string;
  patternId: AlgorithmPatternId;
  severity: 'high' | 'medium';
  filePath: string;
  line: number;
  summary: string;
  complexityBefore: string;
  complexityAfter: string;
  recommendationTitle: string;
  recommendation: string;
  prReadySketch: string;
}

export interface AlgorithmReviewReport {
  generatedAt: string;
  rootDirectory: string;
  targetPath: string;
  scannedFileCount: number;
  findings: AlgorithmFinding[];
}

export interface GenerateAlgorithmReviewOptions {
  rootDirectory: string;
  targetPath: string;
  maxFindings: number;
  now?: () => string;
}

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.work',
  '.ai',
  'dist',
  'node_modules',
]);

const LOOP_HEADER_PATTERN = /\b(?:for|while)\s*\(/;
const NESTED_LOOP_PATTERN = /\b(?:for|while)\s*\(/;
const ARRAY_INCLUDES_PATTERN = /\.(?:includes)\s*\(/;
const ARRAY_FIND_PATTERN = /\.(?:find)\s*\(/;
const ARRAY_FILTER_PATTERN = /\.(?:filter)\s*\(/;
const SET_OR_MAP_HAS_PATTERN = /\b(?:set|map|index|lookup)\w*\.has\s*\(/i;

export async function generateAlgorithmReviewReport(
  options: GenerateAlgorithmReviewOptions,
): Promise<AlgorithmReviewReport> {
  const targetDirectory = path.resolve(options.rootDirectory, options.targetPath);
  const files = await collectTypeScriptFiles(targetDirectory);
  const findings: AlgorithmFinding[] = [];

  for (const filePath of files) {
    const contents = await readFile(filePath, 'utf8');
    findings.push(...analyzeAlgorithmFindings(contents, filePath, options.rootDirectory));
  }

  const ranked = rankAlgorithmFindings(findings).slice(0, Math.max(0, Math.floor(options.maxFindings)));
  return {
    generatedAt: options.now ? options.now() : new Date().toISOString(),
    rootDirectory: options.rootDirectory,
    targetPath: options.targetPath,
    scannedFileCount: files.length,
    findings: ranked,
  };
}

export function renderAlgorithmReviewMarkdown(report: AlgorithmReviewReport): string {
  const lines: string[] = [
    '# Algorithm Performance Review',
    '',
    `Generated: ${report.generatedAt}`,
    `Target path: \`${report.targetPath}\``,
    `Scanned TypeScript files: ${report.scannedFileCount}`,
    '',
    '## Summary',
    `- Findings: ${report.findings.length}`,
    `- High severity: ${report.findings.filter(finding => finding.severity === 'high').length}`,
    `- Medium severity: ${report.findings.filter(finding => finding.severity === 'medium').length}`,
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('## Top recommendations', '', 'No high-confidence algorithmic efficiency hotspots were detected.');
    return lines.join('\n');
  }

  lines.push('## Top recommendations', '');
  for (const finding of report.findings) {
    lines.push(
      `### ${finding.id}. ${finding.recommendationTitle}`,
      `- **Location:** \`${finding.filePath}:${finding.line}\``,
      `- **Pattern:** \`${finding.patternId}\``,
      `- **Current complexity risk:** ${finding.complexityBefore}`,
      `- **Suggested target:** ${finding.complexityAfter}`,
      `- **Why this matters:** ${finding.summary}`,
      `- **Recommendation:** ${finding.recommendation}`,
      '- **PR-ready refactor sketch:**',
      '```ts',
      finding.prReadySketch,
      '```',
      '',
    );
  }

  lines.push(
    '## Output contract',
    '- Each recommendation is designed to be independently shippable as a narrow PR.',
    '- Validate each accepted refactor with targeted tests plus full `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run lint`.',
  );
  return lines.join('\n');
}

export function analyzeAlgorithmFindings(
  sourceText: string,
  absoluteFilePath: string,
  rootDirectory: string,
): AlgorithmFinding[] {
  const lines = sourceText.split(/\r?\n/);
  const findings: AlgorithmFinding[] = [];
  const relativePath = normalizeForReport(path.relative(rootDirectory, absoluteFilePath));

  let loopDepth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    const lineNumber = index + 1;
    const hasLoopHeader = LOOP_HEADER_PATTERN.test(trimmed);

    if (loopDepth > 0) {
      if (ARRAY_INCLUDES_PATTERN.test(trimmed) && !SET_OR_MAP_HAS_PATTERN.test(trimmed)) {
        findings.push(createFinding({
          patternId: 'array_includes_in_loop',
          severity: 'high',
          filePath: relativePath,
          line: lineNumber,
          summary: 'Array membership checks are repeated inside a loop.',
          complexityBefore: 'O(n*m) due to linear membership checks for each iteration.',
          complexityAfter: 'O(n+m) by precomputing a Set and using constant-time lookups.',
          recommendationTitle: 'Replace repeated array membership scans with a Set lookup',
          recommendation: 'Precompute `const lookup = new Set(values)` once, then use `lookup.has(candidate)` in the loop.',
          prReadySketch: [
            'const lookup = new Set(values);',
            'for (const candidate of candidates) {',
            '  if (!lookup.has(candidate)) continue;',
            '  // existing logic',
            '}',
          ].join('\n'),
        }));
      }

      if (ARRAY_FIND_PATTERN.test(trimmed)) {
        findings.push(createFinding({
          patternId: 'array_find_in_loop',
          severity: 'high',
          filePath: relativePath,
          line: lineNumber,
          summary: 'Repeated linear search occurs inside a loop.',
          complexityBefore: 'O(n*m) because each loop iteration scans a collection.',
          complexityAfter: 'O(n+m) by indexing once with a Map and doing O(1) lookups.',
          recommendationTitle: 'Index lookup targets once and replace repeated .find()',
          recommendation: 'Build a Map keyed by the lookup field before the loop and query the map during iteration.',
          prReadySketch: [
            'const byId = new Map(items.map(item => [item.id, item]));',
            'for (const candidate of candidates) {',
            '  const match = byId.get(candidate.id);',
            '  if (!match) continue;',
            '  // existing logic',
            '}',
          ].join('\n'),
        }));
      }

      if (ARRAY_FILTER_PATTERN.test(trimmed)) {
        findings.push(createFinding({
          patternId: 'array_filter_in_loop',
          severity: 'medium',
          filePath: relativePath,
          line: lineNumber,
          summary: 'Filtering inside a loop may repeatedly rescan the same source collection.',
          complexityBefore: 'Commonly O(n*m) when filters re-run per iteration.',
          complexityAfter: 'O(n+m) by grouping/indexing once and reusing the grouped structure.',
          recommendationTitle: 'Pre-group collection data rather than filtering repeatedly',
          recommendation: 'Create a grouped map up front and read from grouped buckets inside the loop.',
          prReadySketch: [
            'const grouped = new Map<string, Item[]>();',
            'for (const item of items) {',
            '  const bucket = grouped.get(item.group) ?? [];',
            '  bucket.push(item);',
            '  grouped.set(item.group, bucket);',
            '}',
            '',
            'for (const group of groups) {',
            '  const relevant = grouped.get(group.id) ?? [];',
            '  // existing logic',
            '}',
          ].join('\n'),
        }));
      }
    }

    if (hasLoopHeader && loopDepth > 0 && NESTED_LOOP_PATTERN.test(trimmed)) {
      findings.push(createFinding({
        patternId: 'nested_loop',
        severity: 'high',
        filePath: relativePath,
        line: lineNumber,
        summary: 'Nested loop detected on a hot traversal path.',
        complexityBefore: 'O(n^2) or worse, depending on loop bounds.',
        complexityAfter: 'Often reducible toward O(n log n) or O(n) with indexing/caching.',
        recommendationTitle: 'Flatten nested traversal with pre-indexed structures',
        recommendation: 'Precompute the secondary loop data into an index and replace inner loop scans with direct lookup.',
        prReadySketch: [
          'const secondaryByKey = new Map(secondary.map(entry => [entry.key, entry]));',
          'for (const primary of primaryItems) {',
          '  const related = secondaryByKey.get(primary.key);',
          '  if (!related) continue;',
          '  // existing logic',
          '}',
        ].join('\n'),
      }));
    }

    const opens = countOccurrences(line, '{');
    const closes = countOccurrences(line, '}');
    const loopDelta = hasLoopHeader && opens === 0 ? 1 : 0;
    loopDepth = Math.max(0, loopDepth + loopDelta + opens - closes);
  }

  return dedupeFindings(findings);
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  await visit(directory, result);
  return result.sort((left, right) => left.localeCompare(right));
}

async function visit(directory: string, result: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      await visit(absolutePath, result);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    result.push(absolutePath);
  }
}

function countOccurrences(text: string, token: string): number {
  let count = 0;
  for (const character of text) {
    if (character === token) count += 1;
  }
  return count;
}

function normalizeForReport(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function createFinding(finding: Omit<AlgorithmFinding, 'id'>): AlgorithmFinding {
  return {
    id: '',
    ...finding,
  };
}

function dedupeFindings(findings: readonly AlgorithmFinding[]): AlgorithmFinding[] {
  const seen = new Set<string>();
  const unique: AlgorithmFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.filePath}:${finding.line}:${finding.patternId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(finding);
  }
  return unique;
}

function rankAlgorithmFindings(findings: readonly AlgorithmFinding[]): AlgorithmFinding[] {
  const severityWeight: Record<AlgorithmFinding['severity'], number> = {
    high: 2,
    medium: 1,
  };
  const patternWeight: Record<AlgorithmPatternId, number> = {
    nested_loop: 4,
    array_includes_in_loop: 3,
    array_find_in_loop: 3,
    array_filter_in_loop: 2,
  };

  const ranked = [...findings].sort((left, right) => {
    const leftScore = severityWeight[left.severity] * 10 + patternWeight[left.patternId];
    const rightScore = severityWeight[right.severity] * 10 + patternWeight[right.patternId];
    if (rightScore !== leftScore) return rightScore - leftScore;
    if (left.filePath !== right.filePath) return left.filePath.localeCompare(right.filePath);
    return left.line - right.line;
  });

  return ranked.map((finding, index) => ({
    ...finding,
    id: `APR-${index + 1}`,
  }));
}
