import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Ignore } from 'ignore';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { RepoSnapshot, RepoFile } from './types.js';
import type { AppConfig } from './config.js';
import {
  assertSafeOutboundText,
  decodeRepositoryText,
  derivePackageHints,
  isExcludedOutboundPath,
  MAX_GITIGNORE_BYTES,
  MAX_GITIGNORE_TOTAL_BYTES,
  MAX_REPOSITORY_ENTRIES,
  MAX_REPOSITORY_PATH_BYTES,
  MAX_REPOSITORY_PATH_DEPTH,
  MAX_REPOSITORY_TEXT_FILE_BYTES,
  MAX_REPOSITORY_TEXT_FILES,
  MAX_REPOSITORY_CONTEXT_BYTES,
  MAX_RECENT_CHANGES_BYTES,
  OutboundContentError,
  readBoundedRepositoryFile,
} from './outbound-content.js';

const require = createRequire(import.meta.url);
const ignoreFactory = require('ignore') as () => Ignore;
let configPromise: Promise<AppConfig> | undefined;

async function getConfig(): Promise<AppConfig> {
  configPromise ??= import('./config.js').then(module => module.config);
  return configPromise;
}

const DEFAULT_IGNORES = [
  'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.pdf', '*.zip', '*.gz', '*.tar',
  '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.DS_Store', '.cache', '.vercel', '.netlify'
];

const TEXT_EXTENSIONS = /\.(ts|tsx|js|jsx|json|md|yml|yaml|css|scss|html|txt|sql|py|rb|go|rs|java|kt|swift|php|cs|c|cpp|h|env\.example)$/i;
const SPECIAL_TEXT_NAMES = new Set(['Dockerfile', 'Procfile', 'Makefile']);

type IgnoreRule = { base: string; matcher: Ignore };
type IgnoreReadBudget = { bytesRead: number };
type RepositoryEntry = { path: string; bytes: number };

function isHardExcludedPath(relativePath: string): boolean {
  return isExcludedOutboundPath(relativePath);
}

function validatePath(relativePath: string): void {
  if (!relativePath || relativePath.includes('\\')
    || Buffer.byteLength(relativePath, 'utf8') > MAX_REPOSITORY_PATH_BYTES) {
    throw new OutboundContentError('ambiguous repository path identity');
  }
  const components = relativePath.split('/');
  if (components.length > MAX_REPOSITORY_PATH_DEPTH
    || components.some(component => !component || component === '.' || component === '..'
      || component !== component.normalize('NFC')
      || /[. ]$/.test(component)
      || /[<>:"|?*\u0000-\u001f]/.test(component)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component))) {
    throw new OutboundContentError('ambiguous repository path identity');
  }
}

export async function ensureRepo(workDir: string): Promise<SimpleGit> {
  const config = await getConfig();
  await fs.mkdir(path.dirname(workDir), { recursive: true });
  try {
    await fs.access(path.join(workDir, '.git'));
  } catch {
    await simpleGit().clone(config.REPO_URL, workDir, ['--depth', '1', '--branch', config.BASE_BRANCH]);
  }
  const git = simpleGit(workDir);
  await git.fetch(['origin', config.BASE_BRANCH, '--depth', '1']);
  await git.checkout(config.BASE_BRANCH);
  await git.pull('origin', config.BASE_BRANCH, { '--ff-only': null });
  return git;
}

function isIgnored(relativePath: string, rules: readonly IgnoreRule[]): boolean {
  return rules.some(({ base, matcher }) => {
    const scopedPath = base ? path.posix.relative(base, relativePath) : relativePath;
    return scopedPath !== '..'
      && !scopedPath.startsWith('../')
      && (matcher.ignores(scopedPath) || matcher.ignores(`${scopedPath}/`));
  });
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function loadIgnoreRules(
  root: string,
  directory: string,
  relativeDirectory: string,
  inherited: readonly IgnoreRule[],
  ignoreReadBudget: IgnoreReadBudget,
): Promise<IgnoreRule[]> {
  const rules = [...inherited];
  try {
    const remainingBytes = MAX_GITIGNORE_TOTAL_BYTES - ignoreReadBudget.bytesRead;
    if (remainingBytes < 0) {
      throw new OutboundContentError('repository .gitignore files exceed their aggregate byte limit');
    }
    let buffer: Buffer;
    try {
      buffer = await readBoundedRepositoryFile(
        root,
        path.join(directory, '.gitignore'),
        Math.min(MAX_GITIGNORE_BYTES, remainingBytes),
      );
    } catch (error) {
      if (remainingBytes < MAX_GITIGNORE_BYTES
        && error instanceof OutboundContentError
        && error.message.endsWith('repository input exceeds its byte limit')) {
        throw new OutboundContentError('repository .gitignore files exceed their aggregate byte limit');
      }
      throw error;
    }
    if (buffer.length > remainingBytes) {
      throw new OutboundContentError('repository .gitignore files exceed their aggregate byte limit');
    }
    ignoreReadBudget.bytesRead += buffer.length;
    const content = decodeRepositoryText(buffer);
    rules.push({ base: relativeDirectory, matcher: ignoreFactory().add(content) });
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  return rules;
}

function isTextPath(file: string): boolean {
  return TEXT_EXTENSIONS.test(file) || SPECIAL_TEXT_NAMES.has(path.posix.basename(file));
}

async function walk(
  root: string,
  directory: string,
  relativeDirectory: string,
  inheritedRules: readonly IgnoreRule[],
  entriesSeen: { count: number },
  ignoreReadBudget: IgnoreReadBudget,
): Promise<RepositoryEntry[]> {
  const rules = await loadIgnoreRules(root, directory, relativeDirectory, inheritedRules, ignoreReadBudget);
  const canonicalRoot = await fs.realpath(root);
  const canonicalDirectory = await fs.realpath(directory);
  const directoryRelative = path.relative(canonicalRoot, canonicalDirectory);
  if (directoryRelative === '..' || directoryRelative.startsWith(`..${path.sep}`)
    || path.isAbsolute(directoryRelative)) {
    throw new OutboundContentError('repository path escapes the containment root');
  }

  const dir = await fs.opendir(directory);
  const files: RepositoryEntry[] = [];
  for await (const entry of dir) {
    entriesSeen.count += 1;
    if (entriesSeen.count > MAX_REPOSITORY_ENTRIES) {
      throw new OutboundContentError('repository entry count exceeds its limit');
    }

    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    validatePath(relativePath);
    if (isHardExcludedPath(relativePath) || entry.name === '.gitignore') continue;
    if (isIgnored(relativePath, rules)) continue;

    const absolutePath = path.join(directory, entry.name);
    const stat = await fs.lstat(absolutePath, { bigint: true });
    if (stat.isSymbolicLink()) {
      throw new OutboundContentError('symbolic links and reparse points are not allowed');
    }
    if (stat.isDirectory()) {
      files.push(...await walk(root, absolutePath, relativePath, rules, entriesSeen, ignoreReadBudget));
      continue;
    }
    if (!stat.isFile()) {
      throw new OutboundContentError('unknown repository path type');
    }
    if (!isTextPath(relativePath)) continue;
    if (stat.size > BigInt(MAX_REPOSITORY_TEXT_FILE_BYTES)) {
      throw new OutboundContentError('repository text file exceeds its per-file byte limit');
    }
    files.push({ path: relativePath, bytes: Number(stat.size) });
  }
  return files;
}

export async function snapshotRepo(workDir: string, git: SimpleGit): Promise<RepoSnapshot> {
  const config = await getConfig();
  const sha = (await git.revparse(['HEAD'])).trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new OutboundContentError('required repository source identity is missing or unreadable');
  }
  const recentChanges = (await git.raw(['log', '--format=%H', '--max-count=20'])).trim();
  if (Buffer.byteLength(recentChanges, 'utf8') > MAX_RECENT_CHANGES_BYTES
    || recentChanges.split(/\r?\n/).some(line => !/^[0-9a-f]{40}$/i.test(line))) {
    throw new OutboundContentError('repository history is missing, ambiguous, or exceeds its byte limit');
  }
  const rootRules = [{ base: '', matcher: ignoreFactory().add(DEFAULT_IGNORES) }];
  const all = await walk(workDir, workDir, '', rootRules, { count: 0 }, { bytesRead: 0 });
  all.sort((a, b) => scoreFile(a.path) - scoreFile(b.path));

  const files: RepoFile[] = [];
  let total = 0;
  const root = await fs.realpath(workDir);
  for (const entry of all) {
    if (files.length >= Math.min(config.MAX_CONTEXT_FILES, MAX_REPOSITORY_TEXT_FILES)) {
      throw new OutboundContentError('repository context exceeds the configured file limit');
    }
    if (total + entry.bytes > Math.min(config.MAX_CONTEXT_BYTES, MAX_REPOSITORY_CONTEXT_BYTES)) {
      throw new OutboundContentError('repository context exceeds the configured aggregate byte limit');
    }
    const absolutePath = path.join(root, ...entry.path.split('/'));
    const buffer = await readBoundedRepositoryFile(root, absolutePath, MAX_REPOSITORY_TEXT_FILE_BYTES);
    if (buffer.length !== entry.bytes) {
      throw new OutboundContentError('repository input changed after classification');
    }
    if (buffer.length === 0) continue;
    const content = decodeRepositoryText(buffer);
    assertSafeOutboundText(content, 'repository text');
    total += buffer.length;
    files.push({ path: entry.path, bytes: buffer.length, content });
  }
  if (files.length === 0) {
    throw new OutboundContentError('required repository text context is missing');
  }

  const packageHints = derivePackageHints(files);

  return {
    owner: config.GITHUB_OWNER,
    repo: config.GITHUB_REPO,
    baseBranch: config.BASE_BRANCH,
    commitSha: sha,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    files,
    recentChanges,
    packageHints
  };
}

function scoreFile(file: string): number {
  if (file === 'README.md') return 0;
  if (file === 'package.json') return 1;
  if (file.includes('/src/') || file.startsWith('src/')) return 2;
  if (file.includes('/app/') || file.startsWith('app/')) return 3;
  if (file.includes('/components/') || file.startsWith('components/')) return 4;
  if (file.includes('test') || file.includes('spec')) return 5;
  return 10;
}
