import fs from 'node:fs/promises';
import path from 'node:path';
import {
  renderIssueBody,
  renderPrComment,
  runBestPracticesReview,
} from './best-practices-reviewer.js';

interface CliOptions {
  outputDir: string;
  maxFiles: number;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let outputDir = '.ai/best-practices-review';
  let maxFiles = 400;

  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '--output-dir') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value for --output-dir');
      }
      outputDir = next;
      i += 1;
      continue;
    }

    if (argument === '--max-files') {
      const next = argv[i + 1];
      const parsed = Number(next);
      if (!next || Number.isNaN(parsed) || parsed <= 0) {
        throw new Error('Invalid value for --max-files');
      }
      maxFiles = parsed;
      i += 1;
    }
  }

  return { outputDir, maxFiles };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBestPracticesReview({
    rootDir: process.cwd(),
    maxFiles: options.maxFiles,
  });

  const outputDir = path.resolve(process.cwd(), options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const reportPath = path.join(outputDir, 'report.json');
  const prCommentPath = path.join(outputDir, 'pr-comment.md');
  const issueBodyPath = path.join(outputDir, 'issue-body.md');
  const tasksPath = path.join(outputDir, 'follow-up-tasks.json');

  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(prCommentPath, `${renderPrComment(report)}\n`, 'utf8');
  await fs.writeFile(issueBodyPath, `${renderIssueBody(report)}\n`, 'utf8');
  await fs.writeFile(tasksPath, `${JSON.stringify(report.followUpTasks, null, 2)}\n`, 'utf8');

  const summary = `Best-practices review complete: ${report.summary.totalFindings} findings (${report.summary.blocking} blocking, ${report.summary.warnings} warnings, ${report.summary.info} info).`;
  console.log(summary);

  const githubSummary = process.env.GITHUB_STEP_SUMMARY;
  if (githubSummary) {
    await fs.appendFile(githubSummary, `${renderPrComment(report)}\n`, 'utf8');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
