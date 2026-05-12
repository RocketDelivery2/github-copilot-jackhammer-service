import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ignore from 'ignore';
import simpleGit, { SimpleGit } from 'simple-git';
import type { RepoSnapshot, RepoFile } from './types.js';
import { config } from './config.js';

const DEFAULT_IGNORES = [
  '.git', 'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.pdf', '*.zip', '*.gz', '*.tar',
  '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.env', '.env.*', '*.pem', '*.key',
  '.DS_Store', '.cache', '.vercel', '.netlify'
];

export async function ensureRepo(workDir: string): Promise<SimpleGit> {
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

async function execFile(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

export async function zipRepo(workDir: string, outPath: string): Promise<string> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.rm(outPath, { force: true });
  await execFile('zip', ['-qr', outPath, '.', '-x', '.git/*', 'node_modules/*', 'dist/*', 'build/*', '.env*'], workDir);
  return outPath;
}

async function walk(dir: string, root: string, ig: ReturnType<typeof ignore>): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replaceAll(path.sep, '/');
    if (ig.ignores(rel) || ig.ignores(`${rel}/`)) continue;
    if (entry.isDirectory()) out.push(...await walk(abs, root, ig));
    else out.push(rel);
  }
  return out;
}

function looksText(file: string): boolean {
  return /\.(ts|tsx|js|jsx|json|md|yml|yaml|css|scss|html|txt|sql|py|rb|go|rs|java|kt|swift|php|cs|c|cpp|h|env\.example)$/i.test(file)
    || ['Dockerfile', 'Procfile', 'Makefile'].includes(path.basename(file));
}

export async function snapshotRepo(workDir: string, git: SimpleGit): Promise<RepoSnapshot> {
  const ig = ignore().add(DEFAULT_IGNORES);
  try {
    const gitignore = await fs.readFile(path.join(workDir, '.gitignore'), 'utf8');
    ig.add(gitignore);
  } catch {}

  const sha = (await git.revparse(['HEAD'])).trim();
  const recentChanges = await git.raw(['log', '--oneline', '--decorate', '--max-count=20']);
  const all = (await walk(workDir, workDir, ig)).filter(looksText);
  all.sort((a, b) => scoreFile(a) - scoreFile(b));

  const files: RepoFile[] = [];
  let total = 0;
  for (const rel of all) {
    if (files.length >= config.MAX_CONTEXT_FILES || total >= config.MAX_CONTEXT_BYTES) break;
    const abs = path.join(workDir, rel);
    const st = await fs.stat(abs);
    if (st.size > 80_000) continue;
    const content = await fs.readFile(abs, 'utf8').catch(() => '');
    if (!content || /\u0000/.test(content)) continue;
    total += Buffer.byteLength(content);
    files.push({ path: rel, bytes: st.size, content });
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
