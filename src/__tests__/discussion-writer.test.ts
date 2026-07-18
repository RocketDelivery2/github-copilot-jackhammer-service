import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildDiscussionKey,
  buildSourceMaterialHash,
  defaultAcquireRunLock,
  defaultLoadDiscussionsState,
  defaultSaveDiscussionsStateAtomically,
  runDiscussionWriter,
  type ActivityFile,
  type DiscussionWriterDependencies,
  type RepositoryActivity,
} from '../discussion-writer.js';

function createActivity(overrides: Partial<RepositoryActivity> = {}): RepositoryActivity {
  return {
    releases: [],
    mergedPullRequests: [{ number: 101, title: 'feat: add deterministic queue rebalance', url: 'https://example.test/pr/101', mergedAt: '2026-07-15T00:00:00Z' }],
    closedIssues: [{ number: 22, title: 'Stabilize queue ordering for retries', url: 'https://example.test/issues/22', closedAt: '2026-07-14T00:00:00Z' }],
    commits: [{ sha: 'abcdef1234567890', message: 'Improve queue scoring determinism', url: 'https://example.test/commit/abcdef', committedAt: '2026-07-13T00:00:00Z' }],
    roadmapIssues: [],
    docsFiles: [{ path: 'docs/ADAPTIVE_QUEUE.md', summary: 'Updated adaptive queue policy guidance' }],
    ...overrides,
  };
}

const FILES: ActivityFile[] = [
  { path: 'README.md', summary: 'JackHammer overview' },
  { path: 'docs/setup.md', summary: 'Setup and workflow docs' },
];

function createDependencies(input: {
  activity?: RepositoryActivity;
  recentTitles?: Array<{ title: string; body: string }>;
  createDiscussionImpl?: () => Promise<{ id: string; number: number; title: string; url: string }>;
  state?: { published: Record<string, { title: string; type: 'weekly-update' | 'release' | 'feature-spotlight' | 'architecture' | 'roadmap' | 'community-question'; sourceMaterialHash: string; publishedAt: string }> ; lastPublishedAt?: string };
  saveStateHook?: (state: unknown) => void;
} = {}): DiscussionWriterDependencies {
  const activity = input.activity ?? createActivity();
  const state = input.state ?? { published: {} };

  return {
    resolveDiscussionCategory: async () => ({ id: 'cat-1', slug: 'general', name: 'General' }),
    readRecentDiscussions: async () => (input.recentTitles ?? []).map((item, index) => ({
      id: `disc-${index + 1}`,
      title: item.title,
      body: item.body,
      url: `https://example.test/discussions/${index + 1}`,
      createdAt: '2026-07-10T00:00:00Z',
    })),
    createDiscussion: input.createDiscussionImpl ?? (async () => ({
      id: 'new-discussion-id',
      number: 77,
      title: 'Weekly development update: repository-backed progress and next priorities',
      url: 'https://example.test/discussions/77',
    })),
    collectRepositoryActivity: async () => activity,
    readRepositoryEvidenceFiles: async () => FILES,
    now: () => new Date('2026-07-18T00:00:00.000Z'),
    loadState: async () => state,
    saveStateAtomically: async (_filePath, nextState) => {
      input.saveStateHook?.(nextState);
    },
    acquireRunLock: async () => async () => {},
  };
}

describe('discussion writer', () => {
  it('disabled feature performs no work', async () => {
    const result = await runDiscussionWriter(createDependencies(), { enabled: false });
    assert.equal(result.status, 'disabled');
  });

  it('dry-run mode performs no mutation', async () => {
    let called = 0;
    const dependencies = createDependencies({ createDiscussionImpl: async () => {
      called += 1;
      return { id: 'x', number: 1, title: 'x', url: 'https://example.test/x' };
    } });

    const result = await runDiscussionWriter(dependencies, { enabled: true, autoPublish: true, dryRun: true });
    assert.equal(result.status, 'preview');
    assert.equal(called, 0);
  });

  it('auto-publish mode calls the GitHub mutation once', async () => {
    let called = 0;
    const dependencies = createDependencies({ createDiscussionImpl: async () => {
      called += 1;
      return { id: 'x', number: 1, title: 'x', url: 'https://example.test/x' };
    } });

    const result = await runDiscussionWriter(dependencies, { enabled: true, autoPublish: true, dryRun: false, minDaysBetweenPosts: 0 });
    assert.equal(result.status, 'published');
    assert.equal(called, 1);
  });

  it('existing content key prevents a duplicate', async () => {
    const baseDeps = createDependencies();
    const first = await runDiscussionWriter(baseDeps, { enabled: true, autoPublish: false });
    assert.equal(first.status, 'preview');
    assert.ok(first.contentKey);

    const duplicateResult = await runDiscussionWriter(createDependencies({
      state: {
        published: {
          [first.contentKey!]: {
            title: first.generated!.title,
            type: first.generated!.type,
            sourceMaterialHash: buildSourceMaterialHash(createActivity(), FILES),
            publishedAt: '2026-07-10T00:00:00.000Z',
          },
        },
      },
    }), { enabled: true, autoPublish: false });

    assert.equal(duplicateResult.status, 'skipped');
  });

  it('identical source material produces the same key', () => {
    const activity = createActivity();
    const hashA = buildSourceMaterialHash(activity, FILES);
    const hashB = buildSourceMaterialHash(activity, FILES);
    const keyA = buildDiscussionKey({
      type: 'weekly-update',
      sourceMaterialHash: hashA,
      activityWindowDays: 14,
      sourceReferences: [{ kind: 'pull-request', identifier: '#101' }],
    });
    const keyB = buildDiscussionKey({
      type: 'weekly-update',
      sourceMaterialHash: hashB,
      activityWindowDays: 14,
      sourceReferences: [{ kind: 'pull-request', identifier: '#101' }],
    });
    assert.equal(keyA, keyB);
  });

  it('changed source material produces a different key', () => {
    const activityA = createActivity();
    const activityB = createActivity({ commits: [{ sha: '9999999999999999', message: 'new commit', url: 'x', committedAt: '2026-07-17T00:00:00Z' }] });
    const keyA = buildDiscussionKey({
      type: 'weekly-update',
      sourceMaterialHash: buildSourceMaterialHash(activityA, FILES),
      activityWindowDays: 14,
      sourceReferences: [{ kind: 'pull-request', identifier: '#101' }],
    });
    const keyB = buildDiscussionKey({
      type: 'weekly-update',
      sourceMaterialHash: buildSourceMaterialHash(activityB, FILES),
      activityWindowDays: 14,
      sourceReferences: [{ kind: 'pull-request', identifier: '#101' }],
    });
    assert.notEqual(keyA, keyB);
  });

  it('missing discussion category fails closed', async () => {
    const dependencies = createDependencies();
    dependencies.resolveDiscussionCategory = async () => null;

    await assert.rejects(() => runDiscussionWriter(dependencies, {
      enabled: true,
      autoPublish: false,
    }));
  });

  it('empty repository activity results in no post', async () => {
    const result = await runDiscussionWriter(createDependencies({
      activity: createActivity({
        mergedPullRequests: [],
        closedIssues: [],
        commits: [],
        docsFiles: [],
      }),
    }), {
      enabled: true,
      autoPublish: false,
      minMaterialChanges: 1,
    });

    assert.equal(result.status, 'skipped');
    assert.equal(result.message, 'No discussion published: no material repository changes were found.');
  });

  it('trivial changes result in no post', async () => {
    const result = await runDiscussionWriter(createDependencies({
      activity: createActivity({
        mergedPullRequests: [{ number: 1, title: 'chore: format docs', url: 'x', mergedAt: '2026-07-17T00:00:00Z' }],
        closedIssues: [{ number: 2, title: 'typo fix', url: 'y', closedAt: '2026-07-17T00:00:00Z' }],
        commits: [{ sha: '1', message: 'lint cleanup', url: 'z', committedAt: '2026-07-17T00:00:00Z' }],
        docsFiles: [],
      }),
    }), { enabled: true, autoPublish: false, minMaterialChanges: 1 });

    assert.equal(result.status, 'skipped');
  });

  it('release activity selects a release announcement', async () => {
    const result = await runDiscussionWriter(createDependencies({
      activity: createActivity({
        releases: [{ id: 'rel-1', tagName: 'v1.2.0', name: 'v1.2.0', url: 'https://example.test/releases/v1.2.0', publishedAt: '2026-07-17T00:00:00Z', body: 'notes' }],
      }),
    }), { enabled: true, autoPublish: false, defaultType: 'auto' });

    assert.equal(result.status, 'preview');
    assert.equal(result.generated?.type, 'release');
  });

  it('approved hashtag inventory is enforced', async () => {
    await assert.rejects(() => runDiscussionWriter(createDependencies(), {
      enabled: true,
      autoPublish: false,
      hashtags: ['#GitHubCopilot', '#CodingAgents', '#AIAgents', '#NotApproved'],
    }));
  });

  it('duplicate hashtags are removed', async () => {
    const result = await runDiscussionWriter(createDependencies(), {
      enabled: true,
      autoPublish: false,
      hashtags: ['#GitHubCopilot', '#GitHubCopilot', '#CodingAgents', '#AIAgents', '#AgenticAI'],
    });

    assert.equal(result.status, 'preview');
    assert.equal(new Set(result.generated?.hashtags ?? []).size, result.generated?.hashtags.length);
  });

  it('unsupported hashtags are rejected', async () => {
    await assert.rejects(() => runDiscussionWriter(createDependencies(), {
      enabled: true,
      autoPublish: false,
      hashtags: ['#GitHubCopilot', '#CodingAgents', '#AIAgents', '#UnsupportedHashtag'],
    }));
  });

  it('source references are required', async () => {
    const result = await runDiscussionWriter(createDependencies({
      activity: createActivity({
        mergedPullRequests: [],
        closedIssues: [],
        commits: [],
        docsFiles: [{ path: 'README.md', summary: 'x' }],
      }),
    }), {
      enabled: true,
      autoPublish: false,
      defaultType: 'feature-spotlight',
    });

    assert.ok((result.generated?.sourceReferences.length ?? 0) > 0);
  });

  it('invalid model output is rejected', async () => {
    const dependencies = createDependencies({
      activity: createActivity({
        mergedPullRequests: [{ number: 1, title: 'revolutionary feature launch', url: 'x', mergedAt: '2026-07-17T00:00:00Z' }],
      }),
    });

    await assert.rejects(() => runDiscussionWriter(dependencies, {
      enabled: true,
      autoPublish: false,
    }), /unsupported claim/i);
  });

  it('failed publication does not update success state', async () => {
    let saved = false;
    const dependencies = createDependencies({
      createDiscussionImpl: async () => {
        throw new Error('create failed');
      },
      saveStateHook: () => {
        saved = true;
      },
    });

    await assert.rejects(() => runDiscussionWriter(dependencies, {
      enabled: true,
      autoPublish: true,
      dryRun: false,
      minDaysBetweenPosts: 0,
    }));

    assert.equal(saved, false);
  });

  it('successful publication atomically updates state', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'discussion-state-'));
    const statePath = path.join(tmpDir, 'state.json');

    const dependencies = createDependencies({
      state: { published: {} },
    });
    dependencies.loadState = () => defaultLoadDiscussionsState(statePath);
    dependencies.saveStateAtomically = (_filePath, state) => defaultSaveDiscussionsStateAtomically(statePath, state);

    const result = await runDiscussionWriter(dependencies, {
      enabled: true,
      autoPublish: true,
      dryRun: false,
      stateFile: statePath,
      minDaysBetweenPosts: 0,
    });

    assert.equal(result.status, 'published');
    const persisted = await defaultLoadDiscussionsState(statePath);
    assert.equal(Object.keys(persisted.published).length, 1);
  });

  it('secrets and excluded files are not included in model context', async () => {
    const result = await runDiscussionWriter(createDependencies(), {
      enabled: true,
      autoPublish: false,
    });

    assert.equal(result.status, 'preview');
    const identifiers = result.generated?.sourceReferences.map(reference => reference.identifier).join(' ') ?? '';
    assert.equal(/\.env|token|secret/i.test(identifiers), false);
  });

  it('multiple simultaneous runs cannot publish duplicates', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'discussion-lock-'));
    const statePath = path.join(tmpDir, 'discussions-state.json');
    const lockPath = `${statePath}.lock`;

    let publishCount = 0;
    const createDiscussion = async () => {
      publishCount += 1;
      await new Promise(resolve => setTimeout(resolve, 50));
      return { id: 'x', number: publishCount, title: 'title', url: `https://example.test/${publishCount}` };
    };

    const buildDeps = (): DiscussionWriterDependencies => ({
      ...createDependencies({ createDiscussionImpl: createDiscussion }),
      loadState: () => defaultLoadDiscussionsState(statePath),
      saveStateAtomically: (_filePath, state) => defaultSaveDiscussionsStateAtomically(statePath, state),
      acquireRunLock: () => defaultAcquireRunLock(lockPath),
    });

    const [a, b] = await Promise.all([
      runDiscussionWriter(buildDeps(), { enabled: true, autoPublish: true, dryRun: false, stateFile: statePath, minDaysBetweenPosts: 0 }),
      runDiscussionWriter(buildDeps(), { enabled: true, autoPublish: true, dryRun: false, stateFile: statePath, minDaysBetweenPosts: 0 }),
    ]);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ['published', 'skipped']);
    assert.equal(publishCount, 1);
  });

  it('existing behavior remains unchanged when feature is disabled', async () => {
    const result = await runDiscussionWriter(createDependencies(), { enabled: false });
    assert.equal(result.status, 'disabled');
  });
});
