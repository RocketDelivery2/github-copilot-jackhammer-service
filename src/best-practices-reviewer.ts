import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ReviewerSeverity = 'blocking' | 'warning' | 'info';
export type ReviewerConfidence = 'high' | 'medium';
export type ReviewerCategory =
  | 'bottleneck'
  | 'code-smell'
  | 'refactor'
  | 'solid-design'
  | 'lint-format'
  | 'maintainability';

export interface ReviewerFinding {
  category: ReviewerCategory;
  severity: ReviewerSeverity;
  confidence: ReviewerConfidence;
  file: string;
  line: number;
  title: string;
  evidence: string;
  recommendation: string;
  safeToAutofix: boolean;
}

export interface FollowUpTask {
  title: string;
  priority: 'high' | 'medium' | 'low';
  body: string;
}

export interface BestPracticesReviewReport {
  verdict: 'pass' | 'needs-work';
  generatedAt: string;
  summary: {
    totalFindings: number;
    blocking: number;
    warnings: number;
    info: number;
    scannedFiles: number;
  };
  findings: ReviewerFinding[];
  safeImmediateFixes: string[];
  followUpTasks: FollowUpTask[];
}

const REVIEWABLE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.md', '.yml', '.yaml']);
const MAX_SCAN_FILE_BYTES = 300_000;

export interface BestPracticesReviewOptions {
  rootDir: string;
  maxFiles?: number;
}

export function analyzeFileContent(file: string, content: string): ReviewerFinding[] {
  const findings: ReviewerFinding[] = [];
  const normalizedPath = file.replaceAll('\\', '/');
  const lines = content.split(/\r?\n/);

  if (lines.length > 500) {
    findings.push({
      category: 'maintainability',
      severity: 'warning',
      confidence: 'high',
      file: normalizedPath,
      line: 1,
      title: 'Large file maintainability hotspot',
      evidence: `${normalizedPath} has ${lines.length} lines.`,
      recommendation: 'Split cohesive chunks into smaller modules with single responsibilities.',
      safeToAutofix: false,
    });
  }

  const anyLine = firstMatchLine(lines, /\bany\b/);
  if (anyLine > 0) {
    findings.push({
      category: 'code-smell',
      severity: 'warning',
      confidence: 'high',
      file: normalizedPath,
      line: anyLine,
      title: 'Type safety gap from any usage',
      evidence: `Found \`any\` in ${normalizedPath}.`,
      recommendation: 'Use explicit domain types or generic constraints instead of any.',
      safeToAutofix: false,
    });
  }

  const tsIgnoreLine = firstMatchLine(lines, /@ts-ignore/);
  if (tsIgnoreLine > 0) {
    findings.push({
      category: 'code-smell',
      severity: 'warning',
      confidence: 'high',
      file: normalizedPath,
      line: tsIgnoreLine,
      title: 'Suppressed type error',
      evidence: `Found \`@ts-ignore\` in ${normalizedPath}.`,
      recommendation: 'Replace ignore directives with narrow typing fixes or guarded code paths.',
      safeToAutofix: false,
    });
  }

  const debtTagLine = firstMatchLine(lines, /\b(TODO|FIXME|HACK)\b/);
  if (debtTagLine > 0) {
    findings.push({
      category: 'maintainability',
      severity: 'info',
      confidence: 'high',
      file: normalizedPath,
      line: debtTagLine,
      title: 'Outstanding technical-debt marker',
      evidence: `Found TODO/FIXME/HACK marker in ${normalizedPath}.`,
      recommendation: 'Track the marker as a follow-up task with explicit owner and closure criteria.',
      safeToAutofix: false,
    });
  }

  const longFunction = findLongFunction(lines, 80);
  if (longFunction) {
    findings.push({
      category: 'refactor',
      severity: 'warning',
      confidence: 'medium',
      file: normalizedPath,
      line: longFunction.line,
      title: 'Long function suggests SRP split opportunity',
      evidence: `${longFunction.name} spans ${longFunction.length} lines.`,
      recommendation: 'Extract pure helpers to reduce branching and improve testability.',
      safeToAutofix: false,
    });
  }

  const trailingWhitespaceLine = firstMatchLine(lines, /[ \t]+$/);
  if (trailingWhitespaceLine > 0) {
    findings.push({
      category: 'lint-format',
      severity: 'info',
      confidence: 'high',
      file: normalizedPath,
      line: trailingWhitespaceLine,
      title: 'Trailing whitespace',
      evidence: `Line ${trailingWhitespaceLine} contains trailing whitespace.`,
      recommendation: 'Trim trailing whitespace for formatting consistency.',
      safeToAutofix: true,
    });
  }

  const leadingTabLine = firstMatchLine(lines, /^\t+/);
  if (leadingTabLine > 0) {
    findings.push({
      category: 'lint-format',
      severity: 'info',
      confidence: 'high',
      file: normalizedPath,
      line: leadingTabLine,
      title: 'Tab indentation drift',
      evidence: `Line ${leadingTabLine} starts with tab indentation.`,
      recommendation: 'Use spaces consistently with repository formatting conventions.',
      safeToAutofix: true,
    });
  }

  if (normalizedPath.startsWith('src/') && /\b(readFileSync|writeFileSync|readdirSync|statSync|existsSync)\b/.test(content)) {
    const syncLine = firstMatchLine(lines, /\b(readFileSync|writeFileSync|readdirSync|statSync|existsSync)\b/);
    findings.push({
      category: 'bottleneck',
      severity: 'warning',
      confidence: 'medium',
      file: normalizedPath,
      line: syncLine > 0 ? syncLine : 1,
      title: 'Synchronous file-system API in runtime path',
      evidence: `Found synchronous fs call in ${normalizedPath}.`,
      recommendation: 'Prefer async fs APIs for non-startup paths to reduce event-loop blocking risk.',
      safeToAutofix: false,
    });
  }

  const exportCount = lines.filter((line) => /^export\s+/.test(line.trim())).length;
  if (exportCount > 12) {
    findings.push({
      category: 'solid-design',
      severity: 'warning',
      confidence: 'medium',
      file: normalizedPath,
      line: 1,
      title: 'High export surface area',
      evidence: `${normalizedPath} exports ${exportCount} members.`,
      recommendation: 'Consider splitting responsibilities to reduce coupling and simplify module APIs.',
      safeToAutofix: false,
    });
  }

  return findings;
}

export async function runBestPracticesReview(
  options: BestPracticesReviewOptions,
): Promise<BestPracticesReviewReport> {
  const rootDir = options.rootDir;
  const maxFiles = options.maxFiles ?? 400;
  const files = await collectReviewableFiles(rootDir, maxFiles);
  const findings: ReviewerFinding[] = [];

  for (const file of files) {
    const absolutePath = path.join(rootDir, file);
    const content = await fs.readFile(absolutePath, 'utf8');
    findings.push(...analyzeFileContent(file, content));
  }

  findings.push(...await analyzeRepositorySignals(rootDir));
  findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const blocking = findings.filter((finding) => finding.severity === 'blocking').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  const info = findings.filter((finding) => finding.severity === 'info').length;

  const safeImmediateFixes = findings
    .filter((finding) => finding.safeToAutofix && finding.confidence === 'high')
    .map((finding) => `${finding.file}:${finding.line} — ${finding.recommendation}`);

  const followUpTasks = buildFollowUpTasks(findings);

  return {
    verdict: blocking > 0 || warnings > 0 ? 'needs-work' : 'pass',
    generatedAt: new Date().toISOString(),
    summary: {
      totalFindings: findings.length,
      blocking,
      warnings,
      info,
      scannedFiles: files.length,
    },
    findings,
    safeImmediateFixes,
    followUpTasks,
  };
}

export function renderPrComment(report: BestPracticesReviewReport): string {
  const topFindings = report.findings.slice(0, 10);
  const lines = topFindings.map((finding) =>
    `- [${finding.severity.toUpperCase()}][${finding.confidence}] \`${finding.file}:${finding.line}\` — ${finding.title}. ${finding.recommendation}`,
  );
  const fixLines = report.safeImmediateFixes.slice(0, 10).map((fix) => `- ${fix}`);

  return [
    '## Best-practices reviewer',
    '',
    `Verdict: **${report.verdict}**`,
    `Findings: **${report.summary.totalFindings}** (blocking: ${report.summary.blocking}, warnings: ${report.summary.warnings}, info: ${report.summary.info})`,
    '',
    '### Top findings',
    ...(lines.length > 0 ? lines : ['- No material findings detected.']),
    '',
    '### Safe immediate fixes',
    ...(fixLines.length > 0 ? fixLines : ['- No high-confidence autofix candidates in this run.']),
  ].join('\n');
}

export function renderIssueBody(report: BestPracticesReviewReport): string {
  const taskBlocks = report.followUpTasks.map((task, index) => {
    return [
      `${index + 1}. **${task.title}** (${task.priority})`,
      '',
      task.body,
    ].join('\n');
  });

  return [
    '# Best-practices reviewer follow-up',
    '',
    `Generated at: ${report.generatedAt}`,
    '',
    `Verdict: **${report.verdict}**`,
    `Findings: **${report.summary.totalFindings}** (blocking: ${report.summary.blocking}, warnings: ${report.summary.warnings}, info: ${report.summary.info})`,
    '',
    '## Suggested follow-up tasks',
    ...(taskBlocks.length > 0 ? taskBlocks : ['No follow-up tasks required from this run.']),
  ].join('\n');
}

function buildFollowUpTasks(findings: ReviewerFinding[]): FollowUpTask[] {
  const grouped = new Map<string, ReviewerFinding[]>();

  for (const finding of findings) {
    if (finding.severity === 'info') {
      continue;
    }

    const key = `${finding.category}:${finding.title}`;
    const list = grouped.get(key) ?? [];
    list.push(finding);
    grouped.set(key, list);
  }

  return Array.from(grouped.values())
    .map((group): FollowUpTask => {
      const first = group[0];
      const scope = group.slice(0, 8).map((finding) => `- ${finding.file}:${finding.line}`).join('\n');
      return {
        title: `[Best Practices] ${first.title}`,
        priority: first.severity === 'blocking' ? 'high' : 'medium',
        body: [
          `Category: ${first.category}`,
          `Severity: ${first.severity}`,
          `Confidence: ${first.confidence}`,
          '',
          `Recommendation: ${first.recommendation}`,
          '',
          'Scope:',
          scope,
        ].join('\n'),
      };
    })
    .slice(0, 12);
}

async function analyzeRepositorySignals(rootDir: string): Promise<ReviewerFinding[]> {
  const findings: ReviewerFinding[] = [];
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJsonRaw = await fs.readFile(packageJsonPath, 'utf8').catch(() => '');

  if (packageJsonRaw) {
    const packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };
    const lintScript = packageJson.scripts?.lint ?? '';
    const hasFormatterScript = Object.keys(packageJson.scripts ?? {}).some((key) => key.includes('format'));
    const lintIsOnlyTypecheck = lintScript.includes('tsc') && !lintScript.includes('eslint') && !lintScript.includes('biome');

    if (lintIsOnlyTypecheck) {
      findings.push({
        category: 'lint-format',
        severity: 'warning',
        confidence: 'high',
        file: 'package.json',
        line: 1,
        title: 'Lint coverage only performs type checking',
        evidence: `lint script: ${lintScript}`,
        recommendation: 'Add a style/static-analysis lane (for example ESLint or Biome) to catch non-type maintainability issues.',
        safeToAutofix: false,
      });
    }

    if (!hasFormatterScript) {
      findings.push({
        category: 'lint-format',
        severity: 'info',
        confidence: 'high',
        file: 'package.json',
        line: 1,
        title: 'No formatter workflow script detected',
        evidence: 'No npm script name includes "format".',
        recommendation: 'Add a formatting script and CI check to keep style drift from accumulating.',
        safeToAutofix: false,
      });
    }
  }

  const diffSignals = await readDiffSignals(rootDir);
  findings.push(...diffSignals);
  return findings;
}

async function readDiffSignals(rootDir: string): Promise<ReviewerFinding[]> {
  const findings: ReviewerFinding[] = [];
  const currentBranch = await gitOutput(rootDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const baseBranch = await inferBaseBranch(rootDir, currentBranch);
  if (!baseBranch) {
    return findings;
  }

  const numstat = await gitOutput(rootDir, ['diff', '--numstat', `${baseBranch}...HEAD`]);
  if (!numstat) {
    return findings;
  }

  for (const line of numstat.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [additionsRaw, deletionsRaw, file] = trimmed.split('\t');
    const additions = Number.parseInt(additionsRaw ?? '0', 10);
    const deletions = Number.parseInt(deletionsRaw ?? '0', 10);
    if (!file || Number.isNaN(additions) || Number.isNaN(deletions)) {
      continue;
    }

    const delta = additions + deletions;
    if (delta > 450) {
      findings.push({
        category: 'refactor',
        severity: 'warning',
        confidence: 'high',
        file,
        line: 1,
        title: 'Large diff slice may hurt reviewability',
        evidence: `${file} changed by ${delta} lines compared with ${baseBranch}.`,
        recommendation: 'Consider splitting this surface into smaller, isolated follow-up PRs.',
        safeToAutofix: false,
      });
    }
  }

  return findings;
}

async function inferBaseBranch(rootDir: string, currentBranch: string): Promise<string | null> {
  const candidates = [`origin/main`, `origin/master`];
  for (const candidate of candidates) {
    const exists = await gitOutput(rootDir, ['rev-parse', '--verify', candidate]);
    if (!exists) {
      continue;
    }

    if (currentBranch === 'main' || currentBranch === 'master') {
      return candidate;
    }

    const mergeBase = await gitOutput(rootDir, ['merge-base', 'HEAD', candidate]);
    if (mergeBase) {
      return candidate;
    }
  }

  return null;
}

async function gitOutput(rootDir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['--no-pager', ...args], { cwd: rootDir });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function collectReviewableFiles(rootDir: string, maxFiles: number): Promise<string[]> {
  const output: string[] = [];
  const skipDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', '.ai']);

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(rootDir, absolutePath).replaceAll(path.sep, '/');

      if (entry.isDirectory()) {
        if (skipDirectories.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!REVIEWABLE_EXTENSIONS.has(extension)) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      if (stat.size > MAX_SCAN_FILE_BYTES) {
        continue;
      }

      output.push(relativePath);
      if (output.length >= maxFiles) {
        return;
      }
    }
  }

  await walk(rootDir);
  output.sort();
  return output.slice(0, maxFiles);
}

function firstMatchLine(lines: readonly string[], pattern: RegExp): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i] ?? '')) {
      return i + 1;
    }
  }

  return 0;
}

function severityRank(severity: ReviewerSeverity): number {
  if (severity === 'blocking') {
    return 3;
  }
  if (severity === 'warning') {
    return 2;
  }
  return 1;
}

function findLongFunction(
  lines: readonly string[],
  threshold: number,
): { name: string; line: number; length: number } | null {
  const signature = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const match = signature.exec(line);
    if (!match) {
      continue;
    }

    let depth = 0;
    let opened = false;
    for (let j = i; j < lines.length; j += 1) {
      const currentLine = lines[j] ?? '';
      for (const char of currentLine) {
        if (char === '{') {
          depth += 1;
          opened = true;
        } else if (char === '}') {
          depth -= 1;
          if (opened && depth <= 0) {
            const length = j - i + 1;
            if (length > threshold) {
              return {
                name: match[1] ?? match[2] ?? 'anonymous',
                line: i + 1,
                length,
              };
            }
            break;
          }
        }
      }
    }
  }

  return null;
}
