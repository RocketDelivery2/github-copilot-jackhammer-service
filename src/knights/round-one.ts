import { createHash, randomUUID } from 'node:crypto';
import { providerRegistry } from '../providers/registry.js';
import type { ProviderId, ProviderResult } from '../providers/types.js';
import { analyzeRoundOneResponses } from './agreement-analysis.js';
import type {
  RoundOneAnalysisInput,
  RoundOneEvidencePacket,
  RoundOneExecutionDependencies,
  RoundOneProviderPacketResult,
  TaskCharterRuntime,
} from './types.js';

export async function executeRoundOne(charter: TaskCharterRuntime, dependencies: RoundOneExecutionDependencies = {}): Promise<RoundOneEvidencePacket> {
  const startedAt = (dependencies.now ?? now)().toISOString();
  const runId = dependencies.runId ?? randomUUID();
  const registry = dependencies.registry ?? providerRegistry;

  const providerResults: RoundOneProviderPacketResult[] = [];
  const analysisInputs: RoundOneAnalysisInput[] = [];
  for (const provider of ['openai', 'anthropic', 'gemini'] as const) {
    const execution = await invokeProvider(provider, charter, registry);
    providerResults.push(execution.packet);
    analysisInputs.push(execution.analysisInput);
  }

  const completedAt = (dependencies.now ?? now)().toISOString();
  const analysis = analyzeRoundOneResponses(analysisInputs);
  const successCount = providerResults.filter((result) => result.success).length;
  const overallStatus = successCount === providerResults.length
    ? 'complete'
    : successCount > 0
      ? 'partial'
      : 'failed';

  return {
    packetVersion: 'round-one-v1',
    runId,
    taskCharterId: charter.id,
    startedAt,
    completedAt,
    overallStatus,
    taskCharter: charter,
    providers: providerResults,
    analysis,
  };
}

export function buildRoundOnePrompt(charter: TaskCharterRuntime, providerId: ProviderId): string {
  const providerModel = charter.providers[providerId].model;
  const lines = [
    'Knights of the Round Table - Round 1 task charter',
    `Provider: ${providerId}`,
    `Model: ${providerModel}`,
    `Task Charter ID: ${charter.id}`,
    `Title: ${charter.title}`,
    '',
    'Objective:',
    charter.objective,
    '',
    'Context:',
    charter.context,
    '',
    'Constraints:',
    ...charter.constraints.map((constraint) => `- ${constraint}`),
    '',
    'Questions:',
    ...(charter.questions.length > 0 ? charter.questions.map((question) => `- ${question}`) : ['- None']),
    '',
    'Required response sections:',
    '- Agreements',
    '- Disagreements',
    '- Factual claims requiring verification',
    '- Proposed next actions',
    '- Human decision status',
    '',
    'Rules:',
    '- Do not mention other providers.',
    '- Do not cite or depend on other provider responses.',
    '- If confidence is low, say so explicitly.',
    '- Keep any claims separate from decisions.',
  ];

  return lines.join('\n');
}

function now(): Date {
  return new Date();
}

async function invokeProvider(
  provider: ProviderId,
  charter: TaskCharterRuntime,
  registry: NonNullable<RoundOneExecutionDependencies['registry']> = providerRegistry,
): Promise<{
  packet: RoundOneProviderPacketResult;
  analysisInput: RoundOneAnalysisInput;
}> {
  const adapter = registry.get(provider);
  let result: ProviderResult;

  try {
    result = await adapter.invoke({
      prompt: buildRoundOnePrompt(charter, provider),
      model: charter.providers[provider].model,
      maxOutputTokens: charter.maxOutputTokens,
      timeoutMs: charter.timeoutMs,
    });
  } catch (error) {
    result = {
      provider,
      model: charter.providers[provider].model,
      text: '',
      success: false,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
      latencyMs: 0,
      requestId: null,
      errorCode: normalizeErrorCode(error),
    };
  }

  const packet = normalizeProviderPacketResult(result);
  return {
    packet,
    analysisInput: {
      provider: packet.provider,
      success: packet.success,
      responseText: result.text,
    },
  };
}

function normalizeProviderPacketResult(result: ProviderResult): RoundOneProviderPacketResult {
  return {
    provider: result.provider,
    model: result.model,
    success: result.success,
    redactedResponseText: redactSensitiveText(result.text),
    rawResponseSha256: createHash('sha256').update(result.text, 'utf8').digest('hex'),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
    latencyMs: result.latencyMs,
    requestId: result.requestId,
    errorCode: result.errorCode,
  };
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{8,}\b/g, '[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(?:xox[pbar]-[A-Za-z0-9-]+)\b/g, '[REDACTED]');
}

function normalizeErrorCode(error: unknown): ProviderResult['errorCode'] {
  if (error instanceof Error && typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    if (message.includes('timeout') || message.includes('abort')) {
      return 'timeout';
    }
    if (message.includes('auth') || message.includes('unauthorized')) {
      return 'auth_error';
    }
    if (message.includes('rate') || message.includes('quota')) {
      return 'rate_limited';
    }
  }

  return 'provider_error';
}
