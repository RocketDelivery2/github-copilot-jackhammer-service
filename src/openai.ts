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
import { assertSafeOutboundText } from './outbound-content.js';

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
    create(input: any): Promise<{ output_text: string }>;
  };
};

export function validateTaskCreationSnapshot(snapshot: RepoSnapshot): void {
  if (!snapshot.commitSha || !/^[0-9a-f]{7,64}$/i.test(snapshot.commitSha)) {
    throw new Error('Outbound content rejected: missing or ambiguous repository source identity');
  }
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0) {
    throw new Error('Outbound content rejected: required repository text context is missing');
  }
  let total = 0;
  for (const hint of snapshot.packageHints) {
    assertSafeOutboundText(hint, 'package hint');
  }
  for (const file of snapshot.files) {
    if (!file.path || file.path.startsWith('/') || file.path.includes('\\') || /(^|\/)\.{1,2}(\/|$)/.test(file.path)) {
      throw new Error('Outbound content rejected: ambiguous repository path');
    }
    if (/(^|\/)\.env(?:\.[^/]*)?$|(^|\/)[^/]+\.(?:pem|key)$|(^|\/)[^/]+\.(?:pem|key)\//i.test(file.path)) {
      throw new Error('Outbound content rejected: excluded sensitive path');
    }
    assertSafeOutboundText(file.content, 'repository text');
    total += Buffer.byteLength(file.content);
  }
  if (total > config.MAX_CONTEXT_BYTES || snapshot.files.length > config.MAX_CONTEXT_FILES) {
    throw new Error('Outbound content rejected: repository context exceeds configured limits');
  }
}

export async function createTasks(
  snapshot: RepoSnapshot,
  guidance: CopilotGuidance | null = null,
  recentResults: CopilotResult[] = [],
  providerClient: ResponsesClient = client,
): Promise<AiTask[]> {
  validateTaskCreationSnapshot(snapshot);
  assertSafeOutboundText(snapshot.recentChanges, 'repository history');
  assertSafeOutboundText(guidance?.rawText ?? 'none', 'guidance text');
  for (const result of recentResults) {
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
  const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: inputText }];

  const response = await providerClient.responses.create({
    model: resolveModel({ call: 'task_creation' }, config),
    instructions: `${TASK_CREATION_INSTRUCTIONS}\n\n${FEEDBACK_LOOP_PROMPT_POLICY}`,
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
  const guidanceContext = buildGuidanceContext(guidance, recentResults);
  const inputText = buildContinuationCommentPrompt({
    activeWork,
    guidanceContext,
    prContext,
  });
  assertSafeOutboundText(inputText, 'provider prompt');
  assertSafeOutboundText(guidance?.rawText ?? 'none', 'guidance text');
  for (const result of recentResults) {
    assertSafeOutboundText(result.summary, 'recent result');
  }

  const response = await providerClient.responses.create({
    model: resolveModel({ call: 'continuation_comment' }, config),
    instructions: 'You are writing a concise GitHub comment to continue a Copilot coding task. Be direct and actionable.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: inputText }] }],
  });

  return response.output_text.trim();
}
