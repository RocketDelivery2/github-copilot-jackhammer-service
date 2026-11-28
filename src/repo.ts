import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Ignore } from 'ignore';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { RepoSnapshot, RepoFile } from './types.js';
import type { AppConfig } from './config.js';
import { assertSafeOutboundText, OutboundContentError } from './outbound-content.js';

const require = createRequire(import.meta.url);
const ignoreFactory = require('ignore') as () => Ignore;
let configPromise: Promise<AppConfig> | undefined;

async function getConfig(): Promise<AppConfig> {
  configPromise ??= import('./config.js').then(module => module.config);
  return configPromise;
}

const DEFAULT_IGNORES = [
  '.git', 'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.pdf', '*.zip', '*.gz', '*.tar',
  '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.env', '.env.*', '*.pem', '*.key',
  '.DS_Store', '.cache', '.vercel', '.netlify'
];

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

async function walk(dir: string, root: string, ig: Ignore): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replaceAll(path.sep, '/');
    const realRoot = await fs.realpath(root);
    const realAbs = await fs.realpath(abs).catch(() => abs);
    const relativeToRoot = path.relative(realRoot, realAbs);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new OutboundContentError('repository path escapes the containment root');
    }
    if (entry.isSymbolicLink()) {
      throw new OutboundContentError('symbolic links and reparse points are not allowed');
    }
    if (ig.ignores(rel) || ig.ignores(`${rel}/`)) continue;
    if (entry.isDirectory()) {
      const st = await fs.lstat(abs);
      if (!st.isDirectory()) throw new OutboundContentError('unsupported directory entry type');
      out.push(...await walk(abs, root, ig));
    } else if (entry.isFile()) {
      const st = await fs.lstat(abs);
      if (!st.isFile()) throw new OutboundContentError('unsupported file entry type');
      out.push(rel);
    } else {
      throw new OutboundContentError('unknown repository path type');
    }
  }
  return out;
}

function looksText(file: string): boolean {
  return /\.(ts|tsx|js|jsx|json|md|yml|yaml|css|scss|html|txt|sql|py|rb|go|rs|java|kt|swift|php|cs|c|cpp|h|env\.example)$/i.test(file)
    || ['Dockerfile', 'Procfile', 'Makefile'].includes(path.basename(file));
}

export async function snapshotRepo(workDir: string, git: SimpleGit): Promise<RepoSnapshot> {
  const config = await getConfig();
  const ig = ignoreFactory().add(DEFAULT_IGNORES);
  try {
    const gitignore = await fs.readFile(path.join(workDir, '.gitignore'), 'utf8');
    ig.add(gitignore);
  } catch {}

  const sha = (await git.revparse(['HEAD'])).trim();
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) {
    throw new OutboundContentError('required repository source identity is missing or unreadable');
  }
  const recentChanges = await git.raw(['log', '--oneline', '--decorate', '--max-count=20']);
  const all = await walk(workDir, workDir, ig);
  all.sort((a, b) => scoreFile(a) - scoreFile(b));

  const files: RepoFile[] = [];
  let total = 0;
  for (const rel of all) {
    if (!looksText(rel)) {
      const absUnknown = path.join(workDir, rel);
      if (/\.(?:bin|exe|dll|so|dylib|class|wasm)$/i.test(rel)) {
        throw new OutboundContentError('unsupported binary file type');
      }
      const buffer = await fs.readFile(absUnknown);
      if (buffer.includes(0) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(buffer.toString('latin1'))) {
        throw new OutboundContentError('unexpected binary file is not allowed in repository context');
      }
      continue;
    }
    if (files.length >= config.MAX_CONTEXT_FILES) {
      throw new OutboundContentError('repository context exceeds the configured file limit');
    }
    const abs = path.join(workDir, rel);
    const st = await fs.stat(abs);
    if (st.size > 80_000) {
      throw new OutboundContentError('repository text file exceeds the per-file size limit');
    }
    const buffer = await fs.readFile(abs);
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new OutboundContentError('unsupported text encoding');
    }
    assertSafeOutboundText(content, 'repository text');
    if (buffer.length === 0) continue;
    const bytes = Buffer.byteLength(content);
    if (total + bytes > config.MAX_CONTEXT_BYTES) {
      throw new OutboundContentError('repository context exceeds the configured aggregate byte limit');
    }
    total += bytes;
    files.push({ path: rel, bytes: st.size, content });
  }
  if (files.length === 0) {
    throw new OutboundContentError('required repository text context is missing');
  }

  const packageHints: string[] = [];
  for (const p of ['package.json', 'pyproject.toml', 'requirements.txt', 'README.md']) {
    try { packageHints.push(`${p}:\n${await fs.readFile(path.join(workDir, p), 'utf8')}`); } catch {}
  }

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
