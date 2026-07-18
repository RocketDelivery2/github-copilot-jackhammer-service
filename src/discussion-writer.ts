import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export type DiscussionType =
  | 'release'
  | 'weekly-update'
  | 'feature-spotlight'
  | 'architecture'
  | 'roadmap'
  | 'community-question';

export type GeneratedDiscussion = {
  type: DiscussionType;
  title: string;
  body: string;
  hashtags: string[];
  sourceReferences: Array<{
    kind: 'release' | 'pull-request' | 'issue' | 'commit' | 'file';
    identifier: string;
  }>;
  rationale: string;
  materialChangeCount: number;
};

export type ActivityRelease = {
  id: string;
  tagName: string;
  name: string;
  url: string;
  publishedAt: string;
  body: string;
};

export type ActivityPullRequest = {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
};

export type ActivityIssue = {
  number: number;
  title: string;
  url: string;
  closedAt: string;
};

export type ActivityCommit = {
  sha: string;
  message: string;
  url: string;
  committedAt: string;
};

export type ActivityFile = {
  path: string;
  summary: string;
};

export type DiscussionCategory = {
  id: string;
  slug: string;
  name: string;
};

export type RecentDiscussion = {
  id: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
};

export type CreatedDiscussion = {
  id: string;
  number: number;
  title: string;
  url: string;
};

export type RepositoryActivity = {
  releases: ActivityRelease[];
  mergedPullRequests: ActivityPullRequest[];
  closedIssues: ActivityIssue[];
  commits: ActivityCommit[];
  roadmapIssues: ActivityIssue[];
  docsFiles: ActivityFile[];
};

export type DiscussionsState = {
  published: Record<string, {
    discussionId?: string;
    discussionUrl?: string;
    title: string;
    type: DiscussionType;
    sourceMaterialHash: string;
    publishedAt: string;
  }>;
  lastPublishedAt?: string;
};

export type DiscussionWriterDependencies = {
  resolveDiscussionCategory: (slugOrName: string) => Promise<DiscussionCategory | null>;
  readRecentDiscussions: (limit: number) => Promise<RecentDiscussion[]>;
  createDiscussion: (input: { categoryId: string; title: string; body: string }) => Promise<CreatedDiscussion>;
  collectRepositoryActivity: (windowDays: number) => Promise<RepositoryActivity>;
  readRepositoryEvidenceFiles: () => Promise<ActivityFile[]>;
  now: () => Date;
  loadState: (filePath: string) => Promise<DiscussionsState>;
  saveStateAtomically: (filePath: string, state: DiscussionsState) => Promise<void>;
  acquireRunLock: (lockFilePath: string) => Promise<() => Promise<void>>;
};

export type DiscussionWriterOptions = {
  enabled?: boolean;
  autoPublish?: boolean;
  categorySlug?: string;
  maxPerRun?: number;
  activityWindowDays?: number;
  minDaysBetweenPosts?: number;
  minMaterialChanges?: number;
  stateFile?: string;
  defaultType?: 'auto' | DiscussionType;
  hashtags?: string[];
  dryRun?: boolean;
};

export type DuplicateCheckResult = {
  isDuplicate: boolean;
  reason: string;
};

export type DiscussionWriterResult = {
  status: 'disabled' | 'skipped' | 'preview' | 'published';
  message: string;
  category?: string;
  duplicateCheck?: DuplicateCheckResult;
  generated?: GeneratedDiscussion;
  contentKey?: string;
  createdDiscussion?: CreatedDiscussion;
};


function envBool(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function getDiscussionDefaultsFromEnv() {
  return {
    enabled: envBool(process.env.DISCUSSIONS_ENABLED),
    autoPublish: envBool(process.env.DISCUSSIONS_AUTO_PUBLISH),
    categorySlug: process.env.DISCUSSIONS_CATEGORY_SLUG || 'general',
    maxPerRun: envInt(process.env.DISCUSSIONS_MAX_PER_RUN, 1),
    activityWindowDays: envInt(process.env.DISCUSSIONS_ACTIVITY_WINDOW_DAYS, 14),
    minDaysBetweenPosts: envInt(process.env.DISCUSSIONS_MIN_DAYS_BETWEEN_POSTS, 7),
    minMaterialChanges: envInt(process.env.DISCUSSIONS_MIN_MATERIAL_CHANGES, 1),
    stateFile: process.env.DISCUSSIONS_STATE_FILE || '.ai/discussions-state.json',
    defaultType: (process.env.DISCUSSIONS_DEFAULT_TYPE || 'auto') as 'auto' | DiscussionType,
    hashtags: (process.env.DISCUSSIONS_HASHTAGS || '#GitHubCopilot,#CodingAgents,#AIAgents,#AgenticAI,#GitHubAutomation,#DevOpsAutomation,#DeveloperTools,#OpenAI,#TypeScript,#NodeJS').split(','),
    dryRun: envBool(process.env.DRY_RUN),
  };
}

const ALLOWED_HASHTAGS = [
  '#GitHubCopilot',
  '#CodingAgents',
  '#AIAgents',
  '#AgenticAI',
  '#GitHubAutomation',
  '#DevOpsAutomation',
  '#DeveloperTools',
  '#OpenAI',
  '#TypeScript',
  '#NodeJS',
  '#SoftwareEngineering',
  '#RepositoryAutomation',
] as const;

const SUPPORTED_DISCUSSION_TYPES: DiscussionType[] = [
  'release',
  'weekly-update',
  'feature-spotlight',
  'architecture',
  'roadmap',
  'community-question',
];

const GENERATED_DISCUSSION_SCHEMA = z.object({
  type: z.enum(SUPPORTED_DISCUSSION_TYPES as [DiscussionType, ...DiscussionType[]]),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  hashtags: z.array(z.string()).min(3).max(6),
  sourceReferences: z.array(z.object({
    kind: z.enum(['release', 'pull-request', 'issue', 'commit', 'file']),
    identifier: z.string().trim().min(1),
  })).min(1),
  rationale: z.string().trim().min(1),
  materialChangeCount: z.number().int().nonnegative(),
});

export function normalizeDiscussionTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildSourceMaterialHash(activity: RepositoryActivity, evidenceFiles: ActivityFile[]): string {
  const stable = JSON.stringify({
    releases: activity.releases.map(release => ({ id: release.id, tagName: release.tagName, publishedAt: release.publishedAt })),
    mergedPullRequests: activity.mergedPullRequests.map(pr => ({ number: pr.number, mergedAt: pr.mergedAt })),
    closedIssues: activity.closedIssues.map(issue => ({ number: issue.number, closedAt: issue.closedAt })),
    commits: activity.commits.map(commit => ({ sha: commit.sha, committedAt: commit.committedAt })),
    roadmapIssues: activity.roadmapIssues.map(issue => ({ number: issue.number, closedAt: issue.closedAt })),
    docsFiles: evidenceFiles.map(file => ({ path: file.path, summary: file.summary.slice(0, 200) })),
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

export function buildDiscussionKey(input: {
  type: DiscussionType;
  sourceMaterialHash: string;
  activityWindowDays: number;
  sourceReferences: GeneratedDiscussion['sourceReferences'];
}): string {
  const refs = [...input.sourceReferences]
    .map(reference => `${reference.kind}:${reference.identifier}`)
    .sort((a, b) => a.localeCompare(b));

  const stable = JSON.stringify({
    type: input.type,
    sourceMaterialHash: input.sourceMaterialHash,
    activityWindowDays: input.activityWindowDays,
    refs,
  });

  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 24);
}

function tokenizeHashtags(raw: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const hashtag of raw) {
    const trimmed = hashtag.trim();
    if (!trimmed) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    deduped.push(trimmed);
  }

  return deduped;
}

export function validateHashtagInventory(hashtagInventory: readonly string[]): void {
  const allowed = new Set<string>(ALLOWED_HASHTAGS);
  for (const hashtag of hashtagInventory) {
    if (!allowed.has(hashtag)) {
      throw new Error(`Invalid DISCUSSIONS_HASHTAGS entry: ${hashtag}.`);
    }
  }
}

function parseHashtagInventory(hashtagsRaw: string[]): string[] {
  const parsed = tokenizeHashtags(hashtagsRaw);
  validateHashtagInventory(parsed);
  return parsed;
}

function selectDiscussionType(
  preferredType: 'auto' | DiscussionType,
  activity: RepositoryActivity,
): DiscussionType {
  if (preferredType !== 'auto') {
    return preferredType;
  }

  if (activity.releases.length > 0) {
    return 'release';
  }

  if (activity.roadmapIssues.length > 0) {
    return 'roadmap';
  }

  const architectureSignal = [
    ...activity.mergedPullRequests.map(pr => pr.title),
    ...activity.commits.map(commit => commit.message),
  ].some(text => /architecture|tradeoff|design|refactor core|orchestration/i.test(text));

  if (architectureSignal) {
    return 'architecture';
  }

  const featureSignal = activity.mergedPullRequests.some(pr => /feat|feature|implement|add/i.test(pr.title));
  if (featureSignal) {
    return 'feature-spotlight';
  }

  if (activity.mergedPullRequests.length > 0 || activity.closedIssues.length > 0 || activity.docsFiles.length > 0) {
    return 'weekly-update';
  }

  return 'community-question';
}

function isTrivialTitle(title: string): boolean {
  return /\b(chore|typo|format|lint|spelling|rename|readme tweak|docs: typo)\b/i.test(title);
}

function countMaterialChanges(activity: RepositoryActivity): number {
  const releaseMaterial = activity.releases.length;
  const prMaterial = activity.mergedPullRequests.filter(pr => !isTrivialTitle(pr.title)).length;
  const issueMaterial = activity.closedIssues.filter(issue => !isTrivialTitle(issue.title)).length;
  const commitMaterial = activity.commits.filter(commit => !isTrivialTitle(commit.message)).length;
  const docsMaterial = activity.docsFiles.filter(file => {
    const normalizedPath = file.path.toLowerCase();
    return normalizedPath === 'readme.md' || normalizedPath.startsWith('docs/');
  }).length;
  return releaseMaterial + prMaterial + issueMaterial + commitMaterial + docsMaterial;
}

function createSourceReferences(type: DiscussionType, activity: RepositoryActivity): GeneratedDiscussion['sourceReferences'] {
  const references: GeneratedDiscussion['sourceReferences'] = [];

  if (type === 'release' && activity.releases[0]) {
    references.push({ kind: 'release', identifier: activity.releases[0].tagName });
  }

  for (const pr of activity.mergedPullRequests.slice(0, 6)) {
    references.push({ kind: 'pull-request', identifier: `#${pr.number}` });
  }

  for (const issue of activity.closedIssues.slice(0, 4)) {
    references.push({ kind: 'issue', identifier: `#${issue.number}` });
  }

  for (const commit of activity.commits.slice(0, 4)) {
    references.push({ kind: 'commit', identifier: commit.sha.slice(0, 12) });
  }

  if (references.length === 0) {
    for (const file of activity.docsFiles.slice(0, 4)) {
      references.push({ kind: 'file', identifier: file.path });
    }
  }

  if (references.length === 0) {
    references.push({ kind: 'file', identifier: 'README.md' });
  }

  return references;
}

function selectHashtags(type: DiscussionType, inventory: readonly string[], includesOpenAI: boolean, references: GeneratedDiscussion['sourceReferences']): string[] {
  const pool = new Set<string>(inventory);
  const selected: string[] = [];

  const add = (tag: string): void => {
    if (!pool.has(tag) || selected.includes(tag)) {
      return;
    }
    selected.push(tag);
  };

  add('#GitHubCopilot');
  add('#CodingAgents');
  add('#GitHubAutomation');

  if (type === 'architecture' || type === 'feature-spotlight' || type === 'weekly-update') {
    add('#TypeScript');
    add('#NodeJS');
  }

  if (type === 'roadmap' || type === 'community-question') {
    add('#SoftwareEngineering');
    add('#DeveloperTools');
  }

  if (references.some(reference => reference.kind === 'release')) {
    add('#DevOpsAutomation');
  }

  if (includesOpenAI) {
    add('#OpenAI');
  }

  for (const fallback of ['#AIAgents', '#AgenticAI', '#RepositoryAutomation', '#DeveloperTools']) {
    add(fallback);
    if (selected.length >= 6) {
      break;
    }
  }

  const finalHashtags = selected.slice(0, 6);
  if (finalHashtags.length < 3) {
    throw new Error('Generated hashtags did not meet minimum count requirements.');
  }

  return finalHashtags;
}

function buildMarkdownBody(
  type: DiscussionType,
  activity: RepositoryActivity,
  sourceReferences: GeneratedDiscussion['sourceReferences'],
): { title: string; body: string; rationale: string } {
  const release = activity.releases[0];
  const mergedPulls = activity.mergedPullRequests.slice(0, 6);
  const closedIssues = activity.closedIssues.slice(0, 6);
  const roadmapIssues = activity.roadmapIssues.slice(0, 6);

  const priorities = mergedPulls.length > 0
    ? mergedPulls.map(pr => `- ${pr.title} ([#${pr.number}](${pr.url}))`).join('\n')
    : '- No merged pull requests were selected in this window.';

  const issueSummary = closedIssues.length > 0
    ? closedIssues.map(issue => `- ${issue.title} ([#${issue.number}](${issue.url}))`).join('\n')
    : '- No completed issues were selected in this window.';

  const roadmapSummary = roadmapIssues.length > 0
    ? roadmapIssues.map(issue => `- ${issue.title} ([#${issue.number}](${issue.url}))`).join('\n')
    : '- No roadmap-tagged issues were selected in this window.';

  const technicalQuestion = 'What additional repository-safety checks or discussion-quality gates should be added before enabling wider automation?';

  if (type === 'release' && release) {
    return {
      title: `Release update: ${release.name || release.tagName}`,
      rationale: `A newly published release (${release.tagName}) is available and provides direct user-visible material.`,
      body: `## Why this release matters
A new JackHammer release is now available, and this post summarizes what changed, why it matters, and where we need focused feedback. The goal is to keep release communication grounded in merged repository evidence so contributors can quickly evaluate impact and next steps.

## Release details
- Release: **${release.name || release.tagName}**
- Version tag: **${release.tagName}**
- Published at: ${release.publishedAt}
- Release notes: ${release.url}

## Primary improvements
${priorities}

## User-visible changes
This release focuses on day-to-day automation reliability and transparent control points. Contributors should notice clearer behavior around task sequencing, explicit dry-run boundaries, and stronger guardrails when activity is not meaningful enough to justify publishing output. These updates prioritize predictable operations over aggressive automation.

## Upgrade or setup notes
1. Pull the latest repository revision and run \`npm ci\`.
2. Validate the installation with \`npm test\`, \`npm run build\`, and \`npm run lint\`.
3. Keep discussion auto-publishing disabled while reviewing preview output and category selection.
4. Confirm repository permissions include Discussions write access only where needed.

## Known limitations
- Discussion generation is intentionally conservative and may skip low-signal activity.
- Duplicate prevention relies on deterministic keys and recent discussion checks; historical posts without markers may require manual review.
- Manual review is still required before enabling automatic publication in production.

## References
${sourceReferences.map(reference => `- ${reference.kind}: ${reference.identifier}`).join('\n')}

## Request for feedback
Please review this release summary and share where the discussion writer should be stricter (or more permissive) about what counts as meaningful material changes. Focused feedback helps keep automation useful for maintainers and contributors.
`,
    };
  }

  if (type === 'roadmap') {
    return {
      title: 'Roadmap discussion: implemented work, in-flight items, and open decisions',
      rationale: 'Roadmap-tagged issue movement was detected in the configured activity window.',
      body: `## Why this roadmap check-in matters
Roadmap communication is most useful when it distinguishes what is already delivered from what is still under active work or proposal. This update summarizes repository-backed signals and separates completed work from planned work to reduce ambiguity.

## Implemented work
${priorities}

## Currently in progress
${issueSummary}

## Proposed work
${roadmapSummary}

## Unresolved decisions
- How strict duplicate rejection should be when title similarity is high but source references differ.
- How to tune minimum material-change thresholds for smaller repositories.
- Whether roadmap updates should include additional architecture references by default.

## Security and reliability notes
Roadmap updates must remain conservative: no generated post should claim a capability that is not backed by repository evidence. Publication must remain disabled by default, and failed publication attempts must not be recorded as successful state transitions.

## References
${sourceReferences.map(reference => `- ${reference.kind}: ${reference.identifier}`).join('\n')}

## Community question
${technicalQuestion}
`,
    };
  }

  if (type === 'architecture') {
    return {
      title: 'Architecture tradeoffs: discussion generation safety and duplicate prevention',
      rationale: 'Recent activity includes architecture/design-oriented changes worth discussing with maintainers.',
      body: `## Problem
Repository automation should publish discussions only when there is meaningful and verifiable repository activity. Uncontrolled generation can create noise, repeat old updates, or overstate what was actually delivered.

## Constraints
- Keep behavior disabled by default.
- Respect global dry-run behavior.
- Avoid adding broad write permissions.
- Reject unsupported hashtags and ungrounded claims.
- Prevent duplicate publications across retries and concurrent runs.

## Selected design
The discussion writer computes a deterministic content key from discussion type, activity-window configuration, source references, and a normalized source-material hash. Before any publication, it checks persisted state and recent GitHub discussions for an embedded marker, title similarity, and source coverage overlap. Publication is allowed only when all checks pass.

## Alternatives considered
- Time-only gating without source hashing (too weak against duplicate material).
- Title-only duplication checks (easy to bypass with minor wording changes).
- Always publishing on schedule (violates the no-noise requirement).

## Tradeoffs
This design favors precision and safety over posting frequency. It may skip borderline updates, but that is acceptable because the system should avoid manufacturing content when evidence is weak.

## Security and reliability consequences
State updates occur only after successful publication to prevent false success records. Locks guard against concurrent duplicate publishing attempts. Failures remain explicit and do not silently fall back to mutation behavior.

## Testing and observability requirements
Coverage includes disablement, dry-run behavior, deterministic keying, duplicate checks, category failures, and failed publication handling. Preview output includes category, title, body, hashtags, references, duplicate-check decisions, and rationale.

## Question for engineers
${technicalQuestion}
`,
    };
  }

  if (type === 'feature-spotlight') {
    return {
      title: 'Feature spotlight: production-safe discussion writer pipeline',
      rationale: 'A feature-oriented activity pattern was detected in merged repository work.',
      body: `## Why this capability matters
The discussion writer capability exists to turn verified repository activity into useful GitHub Discussions without generating noise. Instead of writing generic marketing copy, it focuses on concrete evidence and deterministic policies that contributors can audit.

## What the feature does
- Collects release, pull-request, issue, commit, and documentation signals.
- Rejects low-signal windows with a clear no-publish result.
- Selects the most appropriate discussion type based on repository evidence.
- Generates structured Markdown with explicit references and rationale.
- Applies hashtag policy constraints from an approved inventory.
- Prevents duplicates through deterministic keys, persisted state, and recent discussion checks.
- Supports preview-first execution with optional explicit publication.

## Recent repository evidence
### Merged pull requests
${priorities}

### Completed issues
${issueSummary}

## Reliability and safety controls
The feature remains disabled by default and respects global dry-run settings. Publication state is written atomically only after successful GitHub mutation, reducing corruption risk during failure or retries. Concurrent runs use a lock to avoid duplicate publishing in overlapping workflows.

## Where this helps maintainers
Maintainers can review preview output in GitHub Actions summaries before enabling publication. That supports incremental rollout and immediate rollback without changing broader orchestration behavior.

## Evidence-backed references
${sourceReferences.map(reference => `- ${reference.kind}: ${reference.identifier}`).join('\n')}

## Operational rollout guidance
Start with preview-only execution, inspect the generated title, body, hashtags, and duplicate-check reason, and confirm the category mapping is correct before permitting publication. After that, enable publication only for repositories that already enforce required checks, review policies, and minimal workflow permissions so the discussion writer remains an additive communication layer rather than a bypass around governance.

## Current priorities
- Improve quality thresholds for smaller repositories.
- Expand architecture and roadmap evidence extraction.
- Refine duplicate-source overlap detection for long-running projects.

## Community question
${technicalQuestion}
`,
    };
  }

  if (type === 'community-question') {
    return {
      title: 'Community question: calibrating safe automation for repository discussions',
      rationale: 'No stronger release/roadmap/architecture signal was available, so a focused technical question was selected.',
      body: `## Context
JackHammer is expanding discussion automation in a way that must stay useful for maintainers and contributors. The key challenge is balancing timely communication with strict evidence requirements so generated posts remain trustworthy and technically accurate.

## What is currently implemented
${priorities}

## What is in progress
${issueSummary}

## Why this question is relevant
Discussion quality policies affect whether automation helps or harms repository communication. Duplicate-prevention checks, material-change thresholds, and preview-first workflows can reduce noise, but overly strict policies can also hide useful updates.

## Constraints we are operating under
- No unsupported claims.
- No fabricated metrics.
- No publication for trivial or unchanged material.
- No auto-publish when dry-run is enabled.
- No broad GitHub workflow permissions.

## Focused question
${technicalQuestion}

## Suggested response format
If you have practical recommendations, please share:
1. Which evidence signals should have the highest weight.
2. Which duplicate checks are most important in your workflows.
3. What rollback controls you expect when auto-publish is enabled.
`,
    };
  }

  return {
    title: 'Weekly development update: repository-backed progress and next priorities',
    rationale: 'Meaningful merged pull requests, issues, or documentation changes were detected in the configured window.',
    body: `## Why this weekly update matters
This update summarizes meaningful repository progress and highlights where maintainers want focused technical feedback. The intent is to provide signal, not volume: if repository changes are trivial, no post should be published.

## Merged pull requests
${priorities}

## Completed issues
${issueSummary}

## Documentation, reliability, and architecture highlights
- Discussion generation remains evidence-driven and preview-first.
- Duplicate-prevention checks compare state history, embedded markers, title normalization, and source material coverage.
- Publication controls remain opt-in and disabled by default to preserve safe rollout.

## Current priorities
- Tighten quality thresholds for weekly activity windows.
- Keep deterministic keying stable across reruns.
- Preserve existing JackHammer behavior when the feature is disabled.

## Focused community question
${technicalQuestion}

## References
${sourceReferences.map(reference => `- ${reference.kind}: ${reference.identifier}`).join('\n')}
`,
  };
}

function countWords(text: string): number {
  return text
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)
    .length;
}

function rejectUnsupportedClaims(body: string): void {
  const bannedPhrases = [/\brevolutionary\b/i, /\bperfect\b/i, /\bfully autonomous\b/i];
  if (bannedPhrases.some(pattern => pattern.test(body))) {
    throw new Error('Generated discussion contains unsupported claim language.');
  }
}

function validateGeneratedDiscussion(generated: GeneratedDiscussion): GeneratedDiscussion {
  const parsed = GENERATED_DISCUSSION_SCHEMA.parse(generated);

  const wordCount = countWords(parsed.body);
  if (wordCount < 250 || wordCount > 1200) {
    throw new Error(`Generated discussion body length is out of range (${wordCount} words).`);
  }

  rejectUnsupportedClaims(parsed.body);

  const uniqueHashtags = tokenizeHashtags(parsed.hashtags);
  if (uniqueHashtags.length !== parsed.hashtags.length) {
    throw new Error('Generated discussion hashtags must not contain duplicates.');
  }

  const allowedHashtags = new Set<string>(ALLOWED_HASHTAGS);
  if (uniqueHashtags.some(hashtag => !allowedHashtags.has(hashtag))) {
    throw new Error('Generated discussion contains unsupported hashtags.');
  }

  if (!uniqueHashtags.includes('#GitHubCopilot')) {
    throw new Error('Generated discussion hashtags must include #GitHubCopilot.');
  }

  if (uniqueHashtags.includes('#OpenAI') && !/\bopenai\b/i.test(parsed.body)) {
    throw new Error('Generated discussion includes #OpenAI without OpenAI content.');
  }

  return {
    ...parsed,
    hashtags: uniqueHashtags,
  };
}

function withKeyMarker(body: string, key: string): string {
  const trimmed = body.trimEnd();
  return `${trimmed}\n\n<!-- jackhammer-discussion-key: ${key} -->\n`;
}

function detectDuplicate(input: {
  key: string;
  generated: GeneratedDiscussion;
  sourceMaterialHash: string;
  state: DiscussionsState;
  recentDiscussions: RecentDiscussion[];
}): DuplicateCheckResult {
  if (input.state.published[input.key]) {
    return { isDuplicate: true, reason: 'content-key already exists in persisted state' };
  }

  const marker = `jackhammer-discussion-key: ${input.key}`;
  if (input.recentDiscussions.some(discussion => discussion.body.includes(marker))) {
    return { isDuplicate: true, reason: 'content-key marker found in recent discussions' };
  }

  const normalizedGeneratedTitle = normalizeDiscussionTitle(input.generated.title);
  if (input.recentDiscussions.some(discussion => normalizeDiscussionTitle(discussion.title) === normalizedGeneratedTitle)) {
    return { isDuplicate: true, reason: 'normalized title matches a recent discussion' };
  }

  const stateMaterialMatch = Object.values(input.state.published).some(entry => entry.sourceMaterialHash === input.sourceMaterialHash);
  if (stateMaterialMatch) {
    return { isDuplicate: true, reason: 'source material hash already published' };
  }

  return { isDuplicate: false, reason: 'no duplicate detected' };
}

function shouldSkipForMaterial(input: {
  materialChangeCount: number;
  minMaterialChanges: number;
  activity: RepositoryActivity;
}): boolean {
  if (input.activity.releases.length > 0) {
    return false;
  }

  return input.materialChangeCount < input.minMaterialChanges;
}

function hasIntervalElapsed(now: Date, state: DiscussionsState, minDaysBetweenPosts: number): boolean {
  if (!state.lastPublishedAt || minDaysBetweenPosts <= 0) {
    return true;
  }

  const lastPublished = new Date(state.lastPublishedAt).getTime();
  const elapsedMs = now.getTime() - lastPublished;
  const requiredMs = minDaysBetweenPosts * 24 * 60 * 60 * 1000;
  return elapsedMs >= requiredMs;
}

export async function defaultLoadDiscussionsState(filePath: string): Promise<DiscussionsState> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DiscussionsState>;
    return {
      published: parsed.published ?? {},
      lastPublishedAt: parsed.lastPublishedAt,
    };
  } catch {
    return { published: {} };
  }
}

export async function defaultSaveDiscussionsStateAtomically(filePath: string, state: DiscussionsState): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function defaultAcquireRunLock(lockFilePath: string): Promise<() => Promise<void>> {
  const directory = path.dirname(lockFilePath);
  await fs.mkdir(directory, { recursive: true });

  const handle = await fs.open(lockFilePath, 'wx');
  await handle.writeFile(String(process.pid));

  return async () => {
    await handle.close();
    await fs.rm(lockFilePath, { force: true });
  };
}

export function buildPreviewMarkdown(result: DiscussionWriterResult): string {
  if (!result.generated) {
    return `${result.message}\n`;
  }

  const hashtagsLine = result.generated.hashtags.join(' ');
  const references = result.generated.sourceReferences
    .map(reference => `- ${reference.kind}: ${reference.identifier}`)
    .join('\n');

  return `# JackHammer Discussion Preview

## Proposed category
${result.category ?? 'unknown'}

## Proposed title
${result.generated.title}

## Discussion body
${result.generated.body}

${hashtagsLine}

## Source references
${references}

## Duplicate check
${result.duplicateCheck?.reason ?? 'unknown'}

## Selection rationale
${result.generated.rationale}
`;
}

export function createDefaultDiscussionWriterDependencies(): DiscussionWriterDependencies {
  return {
    resolveDiscussionCategory: async () => {
      throw new Error('resolveDiscussionCategory dependency is not configured.');
    },
    readRecentDiscussions: async () => {
      throw new Error('readRecentDiscussions dependency is not configured.');
    },
    createDiscussion: async () => {
      throw new Error('createDiscussion dependency is not configured.');
    },
    collectRepositoryActivity: async () => {
      throw new Error('collectRepositoryActivity dependency is not configured.');
    },
    readRepositoryEvidenceFiles: async () => {
      throw new Error('readRepositoryEvidenceFiles dependency is not configured.');
    },
    now: () => new Date(),
    loadState: defaultLoadDiscussionsState,
    saveStateAtomically: defaultSaveDiscussionsStateAtomically,
    acquireRunLock: defaultAcquireRunLock,
  };
}

export async function runDiscussionWriter(
  dependencies: DiscussionWriterDependencies,
  options: DiscussionWriterOptions = {},
): Promise<DiscussionWriterResult> {
  const defaults = getDiscussionDefaultsFromEnv();
  const enabled = options.enabled ?? defaults.enabled;
  if (!enabled) {
    return {
      status: 'disabled',
      message: 'Discussion generation is disabled by configuration.',
    };
  }

  const maxPerRun = options.maxPerRun ?? defaults.maxPerRun;
  if (maxPerRun < 1) {
    throw new Error('DISCUSSIONS_MAX_PER_RUN must be at least 1.');
  }

  const activityWindowDays = options.activityWindowDays ?? defaults.activityWindowDays;
  const minDaysBetweenPosts = options.minDaysBetweenPosts ?? defaults.minDaysBetweenPosts;
  const minMaterialChanges = options.minMaterialChanges ?? defaults.minMaterialChanges;
  const autoPublish = (options.autoPublish ?? defaults.autoPublish) && !(options.dryRun ?? defaults.dryRun);
  const stateFile = path.resolve(process.cwd(), options.stateFile ?? defaults.stateFile);
  const lockFilePath = `${stateFile}.lock`;
  const categorySlug = options.categorySlug ?? defaults.categorySlug;
  const defaultType = options.defaultType ?? defaults.defaultType;
  const hashtags = parseHashtagInventory(options.hashtags ?? defaults.hashtags);
  const now = dependencies.now();

  if (maxPerRun !== 1) {
    throw new Error('Only one discussion per run is currently supported.');
  }

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await dependencies.acquireRunLock(lockFilePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return {
        status: 'skipped',
        message: 'No discussion published: another discussion writer run is already active.',
      };
    }
    throw error;
  }

  try {
    const state = await dependencies.loadState(stateFile);
    if (!hasIntervalElapsed(now, state, minDaysBetweenPosts)) {
      return {
        status: 'skipped',
        message: 'No discussion published: minimum interval between posts has not elapsed.',
      };
    }

    const [activity, repositoryFiles] = await Promise.all([
      dependencies.collectRepositoryActivity(activityWindowDays),
      dependencies.readRepositoryEvidenceFiles(),
    ]);

    const discussionType = selectDiscussionType(defaultType, activity);
    const sourceReferences = createSourceReferences(discussionType, activity);
    const sourceMaterialHash = buildSourceMaterialHash(activity, repositoryFiles);
    const materialChangeCount = countMaterialChanges(activity);

    if (shouldSkipForMaterial({ materialChangeCount, minMaterialChanges, activity })) {
      return {
        status: 'skipped',
        message: 'No discussion published: no material repository changes were found.',
      };
    }

    const generatedParts = buildMarkdownBody(discussionType, activity, sourceReferences);
    const selectedHashtags = selectHashtags(
      discussionType,
      hashtags,
      /\bopenai\b/i.test(generatedParts.body),
      sourceReferences,
    );

    const generated = validateGeneratedDiscussion({
      type: discussionType,
      title: generatedParts.title,
      body: generatedParts.body,
      hashtags: selectedHashtags,
      sourceReferences,
      rationale: generatedParts.rationale,
      materialChangeCount,
    });

    const key = buildDiscussionKey({
      type: discussionType,
      sourceMaterialHash,
      activityWindowDays,
      sourceReferences: generated.sourceReferences,
    });

    const recentDiscussions = await dependencies.readRecentDiscussions(20);
    const duplicateCheck = detectDuplicate({
      key,
      generated,
      sourceMaterialHash,
      state,
      recentDiscussions,
    });

    if (duplicateCheck.isDuplicate) {
      return {
        status: 'skipped',
        message: `No discussion published: ${duplicateCheck.reason}.`,
        duplicateCheck,
        generated,
        contentKey: key,
      };
    }

    const category = await dependencies.resolveDiscussionCategory(categorySlug);
    if (!category) {
      throw new Error(`Discussion category could not be resolved: ${categorySlug}.`);
    }

    if (!autoPublish) {
      return {
        status: 'preview',
        message: 'Discussion preview generated. Auto-publish is disabled.',
        category: category.slug,
        duplicateCheck,
        generated,
        contentKey: key,
      };
    }

    const bodyWithMarker = withKeyMarker(generated.body, key);
    const created = await dependencies.createDiscussion({
      categoryId: category.id,
      title: generated.title,
      body: bodyWithMarker,
    });

    const nextState: DiscussionsState = {
      ...state,
      published: {
        ...state.published,
        [key]: {
          discussionId: created.id,
          discussionUrl: created.url,
          title: created.title,
          type: generated.type,
          sourceMaterialHash,
          publishedAt: now.toISOString(),
        },
      },
      lastPublishedAt: now.toISOString(),
    };

    await dependencies.saveStateAtomically(stateFile, nextState);

    return {
      status: 'published',
      message: `Discussion published: ${created.url}`,
      category: category.slug,
      duplicateCheck,
      generated,
      contentKey: key,
      createdDiscussion: created,
    };
  } finally {
    if (releaseLock) {
      await releaseLock();
    }
  }
}
