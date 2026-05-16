import fs from 'node:fs';
import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import { config } from './config.js';
import { ensureNotesSection, stripWrapperText } from './brain.js';
import type { AiTask, CopilotGuidance, CopilotResult, RepoSnapshot, ActiveWorkItem } from './types.js';

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

function buildGuidanceContext(guidance: CopilotGuidance | null, recentResults: CopilotResult[]): string {
  const parts: string[] = [];

  if (guidance) {
    if (guidance.recommendedNextPR) {
      parts.push(`Recommended Next PR from Copilot: ${guidance.recommendedNextPR}`);
    }
    if (guidance.planSteps.length) {
      parts.push(`Plan Steps from Copilot:\n${guidance.planSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
    }
    if (guidance.blockers.length) {
      parts.push(`Known blockers (do NOT propose tasks that require these to be resolved first):\n${guidance.blockers.map(b => `- ${b}`).join('\n')}`);
    }
    if (guidance.notes.length) {
      parts.push(`Notes (future sequencing/caution context only — do NOT implement unless Goal/Tasks explicitly say so):\n${guidance.notes.map(n => `- ${n}`).join('\n')}`);
    }
  }

  if (recentResults.length) {
    const summary = recentResults.slice(0, 5).map(r =>
      `- #${r.issueNumber} "${r.title}": ${r.outcome} — ${r.summary}`
    ).join('\n');
    parts.push(`Recent Copilot results:\n${summary}`);
  }

  return parts.join('\n\n');
}

export async function createTasks(
  snapshot: RepoSnapshot,
  zipPath?: string,
  guidance: CopilotGuidance | null = null,
  recentResults: CopilotResult[] = [],
): Promise<AiTask[]> {
  const compactContext = snapshot.files.map(f => `--- FILE: ${f.path} (${f.bytes} bytes) ---\n${f.content}`).join('\n\n');
  const guidanceContext = buildGuidanceContext(guidance, recentResults);

  const inputText = `
You are creating the GitHub Copilot JackHammer Service coding-agent issue queue for ${snapshot.owner}/${snapshot.repo} on ${snapshot.baseBranch}.
Current commit: ${snapshot.commitSha}
Recent git log:\n${snapshot.recentChanges}
Package/readme hints:\n${snapshot.packageHints.join('\n\n').slice(0, 80_000)}
${guidanceContext ? `\n${guidanceContext}\n` : ''}
Generate up to ${config.MAX_TASKS_PER_RUN} small, reviewable tasks that GitHub Copilot can implement as independent PRs.
Only propose tasks supported by the repo context below. Choose the highest-value next Copilot command and prefer proven architecture patterns, efficient algorithms, and clean design.
Apply corporate software engineering standards: correctness, build stability, test coverage, lint/format quality, security, API contract stability, validation/error handling, maintainability, observability, operational safety, rollback safety, and least-risk incremental delivery.
Prefer small testable commands with clear validation steps. Prioritize blockers and reliability work before new feature polish. Never start the next command while active work is unresolved.
Penalize broad risky rewrites, missing tests, branch spam, secrets exposure, bypassing checks, and unrelated changes.
Every copilot_prompt field MUST end with a Notes section containing at minimum "Notes:\n- None." unless there are real notes.
${FEEDBACK_LOOP_PROMPT_POLICY}
Return strict JSON matching this shape: {"tasks":[...]}. Do not include markdown.

Repo context:\n${compactContext}
`;

  const content: any[] = [{ type: 'input_text', text: inputText }];
  // Uploading the repo zip gives OpenAI an audit artifact. The model may not fully expand every zip in-context,
  // so the text snapshot above remains the source of truth for task creation.
  if (zipPath && fs.existsSync(zipPath)) {
    const uploaded = await client.files.create({ file: await toFile(fs.createReadStream(zipPath), 'repo.zip'), purpose: 'assistants' });
    content.unshift({ type: 'input_file', file_id: uploaded.id });
  }

  const response = await client.responses.create({
    model: config.OPENAI_MODEL,
    instructions: 'You are a senior staff-level engineer producing concise, actionable JackHammer queue GitHub issues for GitHub Copilot coding agent. Select the highest-value next command, enforce industry-standard engineering quality, and keep tasks small, validated, and reviewable. Enforce feedback-loop policy: active work first, answer Copilot questions first, fix failed checks first, then continue with reprioritized queue. Never bypass checks, add secrets, or propose broad unvalidated rewrites. Always return parseable JSON only.',
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
  const inputText = `
You are the GitHub Copilot JackHammer Service autopilot continuing work on issue #${activeWork.issueNumber}: "${activeWork.title}".

${prContext ? `Current PR context:\n${prContext}\n` : ''}
${guidanceContext ? `Copilot guidance:\n${guidanceContext}\n` : ''}

Copilot has either asked a clarifying question or needs a continuation nudge.
Write a brief, direct continuation comment (2-5 sentences) that:
1. Answers any clarifying question with a clear direction.
2. Instructs Copilot to continue implementing the task as described.
3. References any relevant plan steps or recommended next actions.
4. Does NOT start new work outside the current issue scope.
5. Ends with "Please continue." or a similar direct prompt.

Return only the comment text, no JSON wrapper.
`;

  const response = await client.responses.create({
    model: config.OPENAI_MODEL,
    instructions: 'You are writing a concise GitHub comment to continue a Copilot coding task. Be direct and actionable.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: inputText }] }],
  });

  return response.output_text.trim();
}
