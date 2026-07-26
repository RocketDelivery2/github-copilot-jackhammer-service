import 'dotenv/config';
import { z } from 'zod';
import { DEFAULT_DISCUSSION_HASHTAGS_CSV } from './discussion-hashtags.js';

const boolish = z.preprocess(v => {
  if (typeof v !== 'string') return false;
  return ['true', '1', 'yes'].includes(v.toLowerCase());
}, z.boolean());

const MergeMethodSchema = z.enum(['merge', 'squash', 'rebase']);

const ConfigSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_OWNER: z.string().default('RocketDelivery2'),
  GITHUB_REPO: z.string().default('TeamBuilder'),
  REPO_URL: z.string().url().default('https://github.com/RocketDelivery2/TeamBuilder.git'),
  BASE_BRANCH: z.string().default('main'),
  WORK_BRANCH: z.string().default('ai/jackhammer-queue'),
  OPENAI_MODEL: z.string().default('gpt-5.5'),
  POLL_SECONDS: z.coerce.number().int().positive().default(900),
  MAX_TASKS_PER_RUN: z.coerce.number().int().positive().max(20).default(3),
  MAX_CONTEXT_FILES: z.coerce.number().int().positive().default(80),
  MAX_CONTEXT_BYTES: z.coerce.number().int().positive().default(450000),
  QUEUE_DIR: z.string().default('.ai/jackhammer-queue'),
  STATE_FILE: z.string().default('.ai/state.json'),
  DRY_RUN: boolish.default(''),
  COPILOT_ASSIGNEE: z.string().optional().default(''),
  ISSUE_LABELS: z.string().default('ai-task,jackhammer-queue'),
  FULL_AUTOPILOT: boolish.default(''),
  AUTO_MERGE_PR: boolish.default(''),
  AUTO_APPROVE_PR: boolish.default(''),
  AUTO_CLOSE_ISSUE: boolish.optional(),
  CLOSE_ISSUE_AFTER_MERGE: boolish.optional(),
  AUTO_DELETE_BRANCH: boolish.default(''),
  MERGE_METHOD: MergeMethodSchema.default('squash'),
  MAX_RUNTIME_HOURS: z.coerce.number().positive().default(24),
  BRAIN_FALLBACK_ENABLED: boolish.default('true'),
  ADAPTIVE_QUEUE_ENABLED: boolish.default(''),
  ADAPTIVE_EVENT_JOURNAL_PATH: z.string().default('.ai/adaptive-preview-event-journal.json'),
  ADAPTIVE_EVENT_JOURNAL_RETENTION: z.coerce.number().int().nonnegative().default(200),
  ADAPTIVE_PREVIEW_CAPTURE_SOURCE: z.enum(['none', 'recent-results', 'validation-probes']).default('recent-results'),
  ADAPTIVE_PREVIEW_CAPTURE_LIMIT: z.coerce.number().int().nonnegative().max(20).default(3),
  ADAPTIVE_PREVIEW_VALIDATION_PROBES: z.string().default(''),
  ADAPTIVE_PREVIEW_DECISION_INPUTS_FILE: z.string().default(''),
  ADAPTIVE_PREVIEW_APPROVAL_STATE_FILE: z.string().default(''),
  DISCUSSIONS_ENABLED: boolish.default(''),
  DISCUSSIONS_AUTO_PUBLISH: boolish.default(''),
  DISCUSSIONS_CATEGORY_SLUG: z.string().min(1).default('general'),
  DISCUSSIONS_MAX_PER_RUN: z.coerce.number().int().positive().max(3).default(1),
  DISCUSSIONS_ACTIVITY_WINDOW_DAYS: z.coerce.number().int().positive().max(90).default(14),
  DISCUSSIONS_MIN_DAYS_BETWEEN_POSTS: z.coerce.number().int().nonnegative().max(365).default(7),
  DISCUSSIONS_MIN_MATERIAL_CHANGES: z.coerce.number().int().positive().max(50).default(1),
  DISCUSSIONS_STATE_FILE: z.string().min(1).default('.ai/discussions-state.json'),
  DISCUSSIONS_DEFAULT_TYPE: z.enum(['auto', 'release', 'weekly-update', 'feature-spotlight', 'architecture', 'roadmap', 'community-question']).default('auto'),
  DISCUSSIONS_HASHTAGS: z.string().default(DEFAULT_DISCUSSION_HASHTAGS_CSV),
  RUN_ONCE: boolish.default(''),
}).transform(parsed => {
  const closeIssueAfterMerge = parsed.AUTO_CLOSE_ISSUE ?? parsed.CLOSE_ISSUE_AFTER_MERGE ?? false;

  return {
    ...parsed,
    AUTO_CLOSE_ISSUE: closeIssueAfterMerge,
    CLOSE_ISSUE_AFTER_MERGE: closeIssueAfterMerge,
  };
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function parseConfig(env: Record<string, unknown>): AppConfig {
  return ConfigSchema.parse(env);
}

export const config = parseConfig(process.env);
export const labels = config.ISSUE_LABELS.split(',').map(s => s.trim()).filter(Boolean);
