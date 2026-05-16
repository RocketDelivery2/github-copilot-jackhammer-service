import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');

async function findTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTestFiles(absPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(path.relative(ROOT_DIR, absPath).replaceAll(path.sep, '/'));
    }
  }

  return files;
}

async function run() {
  const testFiles = (await findTestFiles(SRC_DIR)).sort();

  if (testFiles.length === 0) {
    console.error('No test files found under src/**/*.test.ts');
    process.exit(1);
  }

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--test', ...testFiles],
    { stdio: 'inherit' }
  );

  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });

  child.on('close', (code, signal) => {
    if (signal) {
      console.error(`Test process terminated by signal: ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
