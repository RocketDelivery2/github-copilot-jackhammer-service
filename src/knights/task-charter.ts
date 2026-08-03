import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { PROVIDER_LIMITS } from '../providers/types.js';

const boundedText = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength);

export const TaskCharterInputSchema = z.object({
  id: boundedText(128),
  title: boundedText(256),
  objective: boundedText(20_000),
  context: boundedText(PROVIDER_LIMITS.maxPromptLength),
  constraints: z.array(boundedText(2_000)).max(64),
  questions: z.array(boundedText(2_000)).max(64),
  maxOutputTokens: z.number().int().positive().max(PROVIDER_LIMITS.maxOutputTokens),
  timeoutMs: z.number().int().positive().max(PROVIDER_LIMITS.maxTimeoutMs),
});

export const TaskCharterRuntimeSchema = TaskCharterInputSchema.extend({
  providers: z.object({
    openai: z.object({ model: boundedText(128) }),
    anthropic: z.object({ model: boundedText(128) }),
    gemini: z.object({ model: boundedText(128) }),
  }),
});

export type TaskCharterInput = z.infer<typeof TaskCharterInputSchema>;
export type TaskCharterRuntime = z.infer<typeof TaskCharterRuntimeSchema>;

export interface TaskCharterModelSelections {
  openaiModel: string;
  anthropicModel: string;
  geminiModel: string;
}

export interface TaskCharterRuntimeOverrides {
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export async function loadTaskCharterFile(filePath: string): Promise<TaskCharterInput> {
  const raw = await readFile(filePath, 'utf8');
  return parseTaskCharterInput(raw);
}

export function parseTaskCharterInput(rawJson: string): TaskCharterInput {
  return TaskCharterInputSchema.parse(JSON.parse(rawJson));
}

export function resolveTaskCharterRuntime(
  input: TaskCharterInput,
  models: TaskCharterModelSelections,
  overrides: TaskCharterRuntimeOverrides = {},
): TaskCharterRuntime {
  const validatedInput = TaskCharterInputSchema.parse(input);
  const runtime = TaskCharterRuntimeSchema.parse({
    ...validatedInput,
    maxOutputTokens: overrides.maxOutputTokens ?? validatedInput.maxOutputTokens,
    timeoutMs: overrides.timeoutMs ?? validatedInput.timeoutMs,
    providers: {
      openai: { model: models.openaiModel },
      anthropic: { model: models.anthropicModel },
      gemini: { model: models.geminiModel },
    },
  });

  return runtime;
}
