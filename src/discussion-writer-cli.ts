import fs from 'node:fs/promises';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { config } from './config.js';
import {
  buildPreviewMarkdown,
  runDiscussionWriter,
  defaultLoadDiscussionsState,
  defaultSaveDiscussionsStateAtomically,
  defaultAcquireRunLock,
  type ActivityFile,
  type RepositoryActivity,
} from './discussion-writer.js';
import {
  createRepositoryDiscussion,
  getLatestPublishedRelease,
  listClosedIssues,
  listMergedPullRequests,
  listRecentCommits,
  listRoadmapIssues,
  readRecentDiscussions,
  resolveDiscussionCategoryBySlugOrName,
} from './github.js';

const argv = yargs(hideBin(process.argv))
  .option('discussion-type', {
    type: 'string',
    choices: ['auto', 'release', 'weekly-update', 'feature-spotlight', 'architecture', 'roadmap', 'community-question'],
  })
  .option('discussion-category', { type: 'string' })
  .option('auto-publish', { type: 'boolean' })
  .option('activity-window-days', { type: 'number' })
  .parseSync();

async function collectRepositoryActivity(windowDays: number): Promise<RepositoryActivity> {
  const [release, mergedPullRequests, closedIssues, commits, roadmapIssues] = await Promise.all([
    getLatestPublishedRelease(windowDays),
    listMergedPullRequests(windowDays),
    listClosedIssues(windowDays),
    listRecentCommits(windowDays),
    listRoadmapIssues(windowDays),
  ]);

  return {
    releases: release ? [release] : [],
    mergedPullRequests,
    closedIssues,
    commits,
    roadmapIssues,
    docsFiles: await readRepositoryEvidenceFiles(),
  };
}

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

function parseActionBoolean(rawValue: string | undefined): boolean | undefined {
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
  if (!config.DISCUSSIONS_ENABLED) {
    throw new Error('Discussions are disabled (DISCUSSIONS_ENABLED=false).');
  }

  const workflowAutoPublish = parseActionBoolean(process.env.INPUT_AUTO_PUBLISH);
  const workflowWindowDays = process.env.INPUT_ACTIVITY_WINDOW_DAYS ? Number(process.env.INPUT_ACTIVITY_WINDOW_DAYS) : undefined;

  const result = await runDiscussionWriter({
    resolveDiscussionCategory: resolveDiscussionCategoryBySlugOrName,
    readRecentDiscussions,
    createDiscussion: createRepositoryDiscussion,
    collectRepositoryActivity,
    readRepositoryEvidenceFiles,
    now: () => new Date(),
    loadState: defaultLoadDiscussionsState,
    saveStateAtomically: defaultSaveDiscussionsStateAtomically,
    acquireRunLock: defaultAcquireRunLock,
  }, {
    autoPublish: argv['auto-publish'] ?? workflowAutoPublish,
    categorySlug: argv['discussion-category'] ?? process.env.INPUT_CATEGORY ?? config.DISCUSSIONS_CATEGORY_SLUG,
    defaultType: parseDiscussionType(String(argv['discussion-type'] ?? process.env.INPUT_DISCUSSION_TYPE ?? '')) ?? config.DISCUSSIONS_DEFAULT_TYPE,
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
