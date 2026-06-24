import 'dotenv/config';
import { z } from 'zod';

const boolish = z.preprocess(v => {
  if (typeof v !== 'string') return false;
  return ['true', '1', 'yes'].includes(v.toLowerCase());
}, z.boolean());

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
  AUTO_CLOSE_ISSUE: boolish.default(''),
  AUTO_DELETE_BRANCH: boolish.default(''),
  MAX_RUNTIME_HOURS: z.coerce.number().positive().default(24),
  BRAIN_FALLBACK_ENABLED: boolish.default('true'),
  ADAPTIVE_QUEUE_ENABLED: boolish.default(''),
  ADAPTIVE_EVENT_JOURNAL_PATH: z.string().default('.ai/adaptive-preview-event-journal.json'),
  ADAPTIVE_EVENT_JOURNAL_RETENTION: z.coerce.number().int().nonnegative().default(200),
  ADAPTIVE_PREVIEW_CAPTURE_SOURCE: z.enum(['none', 'recent-results', 'validation-probes']).default('recent-results'),
  ADAPTIVE_PREVIEW_CAPTURE_LIMIT: z.coerce.number().int().nonnegative().max(20).default(3),
  ADAPTIVE_PREVIEW_VALIDATION_PROBES: z.string().default(''),
  ADAPTIVE_PREVIEW_DECISION_INPUTS_FILE: z.string().default(''),
  RUN_ONCE: boolish.default(''),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function parseConfig(env: Record<string, unknown>): AppConfig {
  return ConfigSchema.parse(env);
}

export const config = parseConfig(process.env);
export const labels = config.ISSUE_LABELS.split(',').map(s => s.trim()).filter(Boolean);
