import fs from 'node:fs';
import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import { config } from './config.js';
import { ensureNotesSection, stripWrapperText } from './brain.js';
import type { AiTask, CopilotGuidance, CopilotResult, RepoSnapshot, ActiveWorkItem } from './types.js';
import {
  TASK_CREATION_INSTRUCTIONS,
  buildContinuationCommentPrompt,
  buildGuidanceContext,
  buildTaskCreationPrompt,
} from './promptContext.js';

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

export async function createTasks(
  snapshot: RepoSnapshot,
  zipPath?: string,
  guidance: CopilotGuidance | null = null,
  recentResults: CopilotResult[] = [],
): Promise<AiTask[]> {
  const compactContext = snapshot.files.map(f => `--- FILE: ${f.path} (${f.bytes} bytes) ---\n${f.content}`).join('\n\n');
  const guidanceContext = buildGuidanceContext(guidance, recentResults);
  const inputText = buildTaskCreationPrompt({
    snapshot,
    compactContext,
    guidanceContext,
    maxTasksPerRun: config.MAX_TASKS_PER_RUN,
  });

  const content: any[] = [{ type: 'input_text', text: inputText }];
  // Uploading the repo zip gives OpenAI an audit artifact. The model may not fully expand every zip in-context,
  // so the text snapshot above remains the source of truth for task creation.
  if (zipPath && fs.existsSync(zipPath)) {
    const uploaded = await client.files.create({ file: await toFile(fs.createReadStream(zipPath), 'repo.zip'), purpose: 'assistants' });
    content.unshift({ type: 'input_file', file_id: uploaded.id });
  }

  const response = await client.responses.create({
    model: config.OPENAI_MODEL,
    instructions: TASK_CREATION_INSTRUCTIONS,
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
): Promise<string> {
  const guidanceContext = buildGuidanceContext(guidance, recentResults);
  const inputText = buildContinuationCommentPrompt({
    activeWork,
    guidanceContext,
    prContext,
  });

  const response = await client.responses.create({
    model: config.OPENAI_MODEL,
    instructions: 'You are writing a concise GitHub comment to continue a Copilot coding task. Be direct and actionable.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: inputText }] }],
  });

  return response.output_text.trim();
}
