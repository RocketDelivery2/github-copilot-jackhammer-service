import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  generateAlgorithmReviewReport,
  renderAlgorithmReviewMarkdown,
} from './algorithm-performance-reviewer.js';

function readMaxFindings(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? '20', 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('ALGO_REVIEWER_MAX_FINDINGS must be a positive integer.');
  }
  return value;
}

async function run(): Promise<void> {
  const rootDirectory = process.cwd();
  const targetPath = process.env.ALGO_REVIEWER_TARGET_PATH ?? 'src';
  const maxFindings = readMaxFindings(process.env.ALGO_REVIEWER_MAX_FINDINGS);
  const outputMarkdown = process.env.ALGO_REVIEWER_OUTPUT_MARKDOWN ?? '.ai/algorithm-performance-review.md';
  const outputJson = process.env.ALGO_REVIEWER_OUTPUT_JSON ?? '.ai/algorithm-performance-review.json';

  const report = await generateAlgorithmReviewReport({
    rootDirectory,
    targetPath,
    maxFindings,
  });
  const markdown = renderAlgorithmReviewMarkdown(report);
  const markdownPath = path.resolve(rootDirectory, outputMarkdown);
  const jsonPath = path.resolve(rootDirectory, outputJson);

  await mkdir(path.dirname(markdownPath), { recursive: true });
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(markdownPath, markdown, 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Algorithm performance review complete: ${report.findings.length} findings`);
  console.log(`Markdown report: ${outputMarkdown}`);
  console.log(`JSON report: ${outputJson}`);
}

run().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Algorithm performance review failed: ${message}`);
  process.exit(1);
});
