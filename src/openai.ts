import OpenAI from 'openai';
import { z } from 'zod';
import { config } from './config.js';
import { ensureNotesSection, stripWrapperText } from './brain.js';
import { resolveModel } from './modelRouter.js';
import type { AiTask, CopilotGuidance, CopilotResult, RepoSnapshot, ActiveWorkItem } from './types.js';
import {
  TASK_CREATION_INSTRUCTIONS,
  buildContinuationCommentPrompt,
  buildGuidanceContext,
  buildTaskCreationPrompt,
} from './promptContext.js';
import {
  assertSafeOutboundText,
  assertWithinUtf8Limit,
  derivePackageHints,
  isExcludedOutboundPath,
  MAX_FINAL_CONTINUATION_PROMPT_BYTES,
  MAX_FINAL_TASK_PROMPT_BYTES,
  MAX_GUIDANCE_FIELD_BYTES,
  MAX_PACKAGE_HINT_BYTES,
  MAX_REPOSITORY_CONTEXT_BYTES,
  MAX_REPOSITORY_TEXT_FILES,
  MAX_REPOSITORY_TEXT_FILE_BYTES,
  MAX_RECENT_CHANGES_BYTES,
  OutboundContentError,
} from './outbound-content.js';

const FEEDBACK_LOOP_PROMPT_POLICY = `
Feedback-loop policy:
- Active work first: if there is an active unresolved issue/PR, continue that before starting new work.
- Answer Copilot questions first with direct continuation guidance.
- Failed checks first: prioritize build/test/lint/check failures before feature expansion.
- Prefer small, reviewable, validated PRs with explicit acceptance criteria and test plans.
- Never bypass checks, never include secrets, and avoid unrelated or broad risky rewrites.
`.trim();

const TaskSchema = z.object({
  title: z.string().min(8).max(120),
  priority: z.enum(['low', 'medium', 'high']),
  type: z.enum(['bug', 'feature', 'refactor', 'test', 'docs', 'security', 'maintenance']),
  summary: z.string().min(20),
  target_files: z.array(z.string()).default([]),
  copilot_prompt: z.string().min(50),
  acceptance_criteria: z.array(z.string()).min(2),
  test_plan: z.array(z.string()).min(1),
  risk_notes: z.array(z.string()).default([])
});
const TaskListSchema = z.object({ tasks: z.array(TaskSchema) });

const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
type ResponsesClient = {
  responses: {
    create(input: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<{ output_text: string }>;
  };
};

export function validateTaskCreationSnapshot(snapshot: RepoSnapshot): void {
  if (!snapshot.commitSha || !/^[0-9a-f]{40}$/i.test(snapshot.commitSha)) {
    throw new Error('Outbound content rejected: missing or ambiguous repository source identity');
  }
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0
    || snapshot.files.length > Math.min(config.MAX_CONTEXT_FILES, MAX_REPOSITORY_TEXT_FILES)
    || snapshot.fileCount !== snapshot.files.length) {
    throw new Error('Outbound content rejected: required repository text context is missing');
  }
  assertWithinUtf8Limit(snapshot.owner, 128, 'repository owner');
  assertWithinUtf8Limit(snapshot.repo, 128, 'repository name');
  assertWithinUtf8Limit(snapshot.baseBranch, 256, 'repository base branch');
  assertSafeOutboundText(snapshot.owner, 'repository owner');
  assertSafeOutboundText(snapshot.repo, 'repository name');
  assertSafeOutboundText(snapshot.baseBranch, 'repository base branch');
  assertWithinUtf8Limit(snapshot.generatedAt, 64, 'snapshot timestamp');
  if (!Number.isFinite(Date.parse(snapshot.generatedAt))) {
    throw new OutboundContentError('snapshot timestamp is missing or invalid');
  }
  assertWithinUtf8Limit(snapshot.recentChanges, MAX_RECENT_CHANGES_BYTES, 'repository history');
  assertSafeOutboundText(snapshot.recentChanges, 'repository history');
  if (!Array.isArray(snapshot.packageHints) || snapshot.packageHints.length > 4) {
    throw new OutboundContentError('package hints exceed their count limit');
  }
  let total = 0;
  const identities = new Set<string>();
  for (const hint of snapshot.packageHints) {
    assertWithinUtf8Limit(hint, MAX_PACKAGE_HINT_BYTES, 'package hint');
    assertSafeOutboundText(hint, 'package hint');
    total += Buffer.byteLength(hint, 'utf8');
  }
  for (const file of snapshot.files) {
    const components = file.path.split('/');
    if (!file.path || file.path.startsWith('/') || file.path.includes('\\') || /(^|\/)\.{1,2}(\/|$)/.test(file.path)
      || file.path !== file.path.normalize('NFC')
      || components.some(component => !component || /[. ]$/.test(component)
        || /[<>:"|?*\u0000-\u001f]/.test(component)
        || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component))) {
      throw new Error('Outbound content rejected: ambiguous repository path');
    }
    if (isExcludedOutboundPath(file.path)) {
      throw new Error('Outbound content rejected: excluded sensitive path');
    }
    assertWithinUtf8Limit(file.path, 4_096, 'repository path');
    assertWithinUtf8Limit(file.content, MAX_REPOSITORY_TEXT_FILE_BYTES, 'repository text file');
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_REPOSITORY_TEXT_FILE_BYTES) {
      throw new OutboundContentError('repository file size identity is ambiguous');
    }
    assertSafeOutboundText(file.content, 'repository text');
    if (Buffer.byteLength(file.content, 'utf8') !== file.bytes) {
      throw new OutboundContentError('repository file byte identity is ambiguous');
    }
    total += Buffer.byteLength(file.path, 'utf8') + Buffer.byteLength(file.content, 'utf8') + 128;
    const identity = file.path.toLocaleLowerCase('en-US');
    if (identities.has(identity)) {
      throw new OutboundContentError('repository file identity is ambiguous');
    }
    identities.add(identity);
  }
  if (JSON.stringify(snapshot.packageHints) !== JSON.stringify(derivePackageHints(snapshot.files))) {
    throw new OutboundContentError('package hints do not match validated repository content');
  }
  if (total > Math.min(config.MAX_CONTEXT_BYTES, MAX_REPOSITORY_CONTEXT_BYTES)) {
    throw new Error('Outbound content rejected: repository context exceeds configured limits');
  }
}

export function createTasks(
  snapshot: RepoSnapshot,
  guidance?: CopilotGuidance | null,
  recentResults?: CopilotResult[],
  providerClient?: ResponsesClient,
): Promise<AiTask[]>;
export function createTasks(
  snapshot: RepoSnapshot,
  zipPath: string | undefined,
  guidance?: CopilotGuidance | null,
  recentResults?: CopilotResult[],
  providerClient?: ResponsesClient,
): Promise<AiTask[]>;
export async function createTasks(
  snapshot: RepoSnapshot,
  second?: string | CopilotGuidance | null,
  third?: CopilotGuidance | CopilotResult[] | null,
  fourth?: CopilotResult[] | ResponsesClient,
  fifth?: ResponsesClient,
): Promise<AiTask[]> {
  const archiveStyle = typeof second === 'string' || (Array.isArray(fourth) && !Array.isArray(third));
  const guidance = archiveStyle
    ? isCopilotGuidance(third) ? third : null
    : isCopilotGuidance(second) ? second : null;
  const recentResults = archiveStyle
    ? Array.isArray(fourth) ? fourth : []
    : Array.isArray(third) ? third : [];
  const providerClient = archiveStyle
    ? fifth ?? client
    : isResponsesClient(fourth) ? fourth : client;
  validateTaskCreationSnapshot(snapshot);
  assertGuidanceWithinLimits(guidance);
  if (recentResults.length > 5) {
    throw new OutboundContentError('recent results exceed their count limit');
  }
  for (const result of recentResults) {
    assertWithinUtf8Limit(result.title, 512, 'recent result title');
    assertWithinUtf8Limit(result.summary, 4_000, 'recent result');
    assertSafeOutboundText(result.summary, 'recent result');
  }
  const compactContext = snapshot.files.map(f => `--- FILE: ${f.path} (${f.bytes} bytes) ---\n${f.content}`).join('\n\n');
  const guidanceContext = buildGuidanceContext(guidance, recentResults);
  const inputText = buildTaskCreationPrompt({
    snapshot,
    compactContext,
    guidanceContext,
    maxTasksPerRun: config.MAX_TASKS_PER_RUN,
  });

  assertSafeOutboundText(inputText, 'provider prompt');
  const providerInstructions = `${TASK_CREATION_INSTRUCTIONS}\n\n${FEEDBACK_LOOP_PROMPT_POLICY}`;
  assertWithinUtf8Limit(inputText, MAX_FINAL_TASK_PROMPT_BYTES, 'task prompt');
  assertWithinUtf8Limit(providerInstructions, 4_000, 'provider instructions');
  assertWithinUtf8Limit(inputText + providerInstructions, MAX_FINAL_TASK_PROMPT_BYTES, 'complete task request');
  const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: inputText }];

  const response = await providerClient.responses.create({
    model: resolveModel({ call: 'task_creation' }, config),
    instructions: providerInstructions,
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: 'jackhammer_queue_tasks',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            tasks: {
              type: 'array',
              maxItems: config.MAX_TASKS_PER_RUN,
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  title: { type: 'string' },
                  priority: { type: 'string', enum: ['low', 'medium', 'high'] },
                  type: { type: 'string', enum: ['bug', 'feature', 'refactor', 'test', 'docs', 'security', 'maintenance'] },
                  summary: { type: 'string' },
                  target_files: { type: 'array', items: { type: 'string' } },
                  copilot_prompt: { type: 'string' },
                  acceptance_criteria: { type: 'array', items: { type: 'string' } },
                  test_plan: { type: 'array', items: { type: 'string' } },
                  risk_notes: { type: 'array', items: { type: 'string' } }
                },
                required: ['title', 'priority', 'type', 'summary', 'target_files', 'copilot_prompt', 'acceptance_criteria', 'test_plan', 'risk_notes']
              }
            }
          },
          required: ['tasks']
        }
      }
    }
  });

  const parsed = TaskListSchema.parse(JSON.parse(response.output_text));
  // Ensure every copilot_prompt has a Notes section and strip wrapper text.
  return parsed.tasks.map(task => ({
    ...task,
    copilot_prompt: ensureNotesSection(stripWrapperText(task.copilot_prompt)),
  }));
}

function isCopilotGuidance(value: unknown): value is CopilotGuidance | null {
  return value === null || (typeof value === 'object' && value !== null && 'planSteps' in value);
}

function isResponsesClient(value: unknown): value is ResponsesClient {
  return typeof value === 'object' && value !== null && 'responses' in value;
}

/**
 * Generates a continuation comment for an active work item.
 * Used when Copilot has asked a question or needs nudging to continue.
 */
export async function createContinuationComment(
  activeWork: ActiveWorkItem,
  guidance: CopilotGuidance | null,
  recentResults: CopilotResult[],
  prContext: string,
  providerClient: ResponsesClient = client,
): Promise<string> {
  assertGuidanceWithinLimits(guidance);
  if (!Number.isSafeInteger(activeWork.issueNumber) || activeWork.issueNumber < 1) {
    throw new OutboundContentError('active work identity is invalid');
  }
  assertWithinUtf8Limit(activeWork.title, 512, 'active work title');
  assertWithinUtf8Limit(prContext, 16_000, 'pull request context');
  if (recentResults.length > 5) {
    throw new OutboundContentError('recent results exceed their count limit');
  }
  for (const result of recentResults) {
    assertWithinUtf8Limit(result.title, 512, 'recent result title');
    assertWithinUtf8Limit(result.summary, 4_000, 'recent result');
    assertSafeOutboundText(result.summary, 'recent result');
  }
  const guidanceContext = buildGuidanceContext(guidance, recentResults);
  const inputText = buildContinuationCommentPrompt({
    activeWork,
    guidanceContext,
    prContext,
  });
  assertSafeOutboundText(inputText, 'provider prompt');
  const instructions = 'You are writing a concise GitHub comment to continue a Copilot coding task. Be direct and actionable.';
  assertWithinUtf8Limit(inputText, MAX_FINAL_CONTINUATION_PROMPT_BYTES, 'continuation prompt');
  assertSafeOutboundText(prContext, 'pull request context');
  assertWithinUtf8Limit(instructions, 2_000, 'provider instructions');
  assertWithinUtf8Limit(inputText + instructions, MAX_FINAL_CONTINUATION_PROMPT_BYTES, 'complete continuation request');

  const response = await providerClient.responses.create({
    model: resolveModel({ call: 'continuation_comment' }, config),
    instructions,
    input: [{ role: 'user', content: [{ type: 'input_text', text: inputText }] }],
  });

  return response.output_text.trim();
}

function assertGuidanceWithinLimits(guidance: CopilotGuidance | null): void {
  if (!guidance) return;
  const fields = [
    guidance.rawText,
    guidance.recommendedNextPR ?? '',
    ...guidance.planSteps,
    ...guidance.notes,
    ...guidance.validation,
    ...guidance.blockers,
    ...guidance.errors,
  ];
  if (fields.length > 52) {
    throw new OutboundContentError('guidance exceeds its field-count limit');
  }
  let total = 0;
  for (const field of fields) {
    assertWithinUtf8Limit(field, MAX_GUIDANCE_FIELD_BYTES, 'guidance field');
    assertSafeOutboundText(field || 'none', 'guidance field');
    total += Buffer.byteLength(field, 'utf8');
  }
  if (total > 24_000) throw new OutboundContentError('guidance exceeds its aggregate byte limit');
  if (guidance.planSteps.length > 10 || guidance.notes.length > 10
    || guidance.validation.length > 10 || guidance.blockers.length > 10 || guidance.errors.length > 10) {
    throw new OutboundContentError('guidance exceeds its field-count limit');
  }
}
