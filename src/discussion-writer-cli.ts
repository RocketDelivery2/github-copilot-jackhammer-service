import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import {
  buildPreviewMarkdown,
  runDiscussionWriter,
  defaultLoadDiscussionsState,
  defaultSaveDiscussionsStateAtomically,
  defaultAcquireRunLock,
  resolveDiscussionCategorySlug,
  type ActivityFile,
  type RepositoryActivity,
} from './discussion-writer.js';

const argv = yargs(hideBin(process.argv))
  .option('discussion-type', {
    type: 'string',
    choices: ['auto', 'release', 'weekly-update', 'feature-spotlight', 'architecture', 'roadmap', 'community-question'],
  })
  .option('discussion-category', { type: 'string' })
  .option('auto-publish', { type: 'boolean' })
  .option('activity-window-days', { type: 'number' })
  .parseSync();

async function readRepositoryEvidenceFiles(): Promise<ActivityFile[]> {
  const root = process.cwd();
  const candidates = [
    'README.md',
    'docs',
    'package.json',
  ];

  const results: ActivityFile[] = [];

  for (const candidate of candidates) {
    const absolutePath = path.join(root, candidate);
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat) {
      continue;
    }

    if (stat.isDirectory()) {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) {
          continue;
        }
        const filePath = path.join(absolutePath, entry.name);
        const content = await fs.readFile(filePath, 'utf8').catch(() => '');
        results.push({
          path: path.relative(root, filePath).replaceAll(path.sep, '/'),
          summary: content.slice(0, 1500),
        });
      }
      continue;
    }

    const content = await fs.readFile(absolutePath, 'utf8').catch(() => '');
    results.push({
      path: path.relative(root, absolutePath).replaceAll(path.sep, '/'),
      summary: content.slice(0, 1500),
    });
  }

  return results;
}

function parseWorkflowInputBoolean(rawValue: string | undefined): boolean | undefined {
  if (rawValue === undefined || rawValue === '') {
    return undefined;
  }

  const normalized = rawValue.toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean input: ${rawValue}`);
}


function parseDiscussionType(rawValue: string | undefined): 'auto' | 'release' | 'weekly-update' | 'feature-spotlight' | 'architecture' | 'roadmap' | 'community-question' | undefined {
  if (!rawValue) {
    return undefined;
  }

  const allowed = new Set(['auto', 'release', 'weekly-update', 'feature-spotlight', 'architecture', 'roadmap', 'community-question']);
  if (!allowed.has(rawValue)) {
    throw new Error(`Invalid discussion type: ${rawValue}`);
  }

  return rawValue as 'auto' | 'release' | 'weekly-update' | 'feature-spotlight' | 'architecture' | 'roadmap' | 'community-question';
}

async function writePreviewArtifacts(markdown: string): Promise<void> {
  const previewPath = path.resolve(process.cwd(), '.ai', 'discussion-preview.md');
  await fs.mkdir(path.dirname(previewPath), { recursive: true });
  await fs.writeFile(previewPath, markdown, 'utf8');

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    await fs.appendFile(summaryPath, `${markdown}\n`, 'utf8');
  }

  console.log(`Discussion preview written to ${previewPath}`);
}

async function main(): Promise<void> {
  if (!['true', '1', 'yes'].includes(process.env.DISCUSSIONS_ENABLED?.toLowerCase() ?? '')) {
    console.log('Discussion generation is disabled by configuration.');
    return;
  }

  const github = await import('./discussion-writer-github.js');
  const collectRepositoryActivity = async (windowDays: number): Promise<RepositoryActivity> => {
    const [release, mergedPullRequests, closedIssues, commits, roadmapIssues] = await Promise.all([
      github.getLatestPublishedRelease(windowDays),
      github.listMergedPullRequests(windowDays),
      github.listClosedIssues(windowDays),
      github.listRecentCommits(windowDays),
      github.listRoadmapIssues(windowDays),
    ]);

    return {
      releases: release ? [release] : [],
      mergedPullRequests,
      closedIssues,
      commits,
      roadmapIssues,
      docsFiles: await readRepositoryEvidenceFiles(),
    };
  };

  const workflowAutoPublish = parseWorkflowInputBoolean(process.env.INPUT_AUTO_PUBLISH);
  const workflowWindowDays = process.env.INPUT_ACTIVITY_WINDOW_DAYS ? Number(process.env.INPUT_ACTIVITY_WINDOW_DAYS) : undefined;
  const requestedDiscussionType = argv['discussion-type'] ?? process.env.INPUT_DISCUSSION_TYPE ?? '';
  const defaultType = parseDiscussionType(String(requestedDiscussionType))
    ?? parseDiscussionType(process.env.DISCUSSIONS_DEFAULT_TYPE)
    ?? 'auto';
  const categorySlug = resolveDiscussionCategorySlug(
    argv['discussion-category'],
    process.env.INPUT_CATEGORY,
    process.env.DISCUSSIONS_CATEGORY_SLUG,
  );

  const result = await runDiscussionWriter({
    resolveDiscussionCategory: github.resolveDiscussionCategoryBySlugOrName,
    readRecentDiscussions: github.readRecentDiscussions,
    createDiscussion: github.createRepositoryDiscussion,
    collectRepositoryActivity,
    readRepositoryEvidenceFiles,
    now: () => new Date(),
    loadState: defaultLoadDiscussionsState,
    saveStateAtomically: defaultSaveDiscussionsStateAtomically,
    acquireRunLock: defaultAcquireRunLock,
  }, {
    autoPublish: argv['auto-publish'] ?? workflowAutoPublish,
    categorySlug,
    defaultType,
    activityWindowDays: argv['activity-window-days'] ?? workflowWindowDays,
  });

  console.log(result.message);
  if (result.status === 'preview' || result.status === 'published') {
    const preview = buildPreviewMarkdown(result);
    await writePreviewArtifacts(preview);
  }

  if (result.status === 'skipped' || result.status === 'disabled') {
    return;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
