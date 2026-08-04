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
  let result: ProviderResult;

  try {
    const adapter = registry.get(provider);
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

  const rawResponseSha256 = createHash('sha256').update(result.text, 'utf8').digest('hex');
  const redactedResponseText = redactSensitiveText(result.text);
  const packet = normalizeProviderPacketResult(result, redactedResponseText, rawResponseSha256);
  return {
    packet,
    analysisInput: {
      provider: packet.provider,
      success: packet.success,
      responseText: redactedResponseText,
    },
  };
}

function normalizeProviderPacketResult(
  result: ProviderResult,
  redactedResponseText: string,
  rawResponseSha256: string,
): RoundOneProviderPacketResult {
  return {
    provider: result.provider,
    model: result.model,
    success: result.success,
    redactedResponseText,
    rawResponseSha256,
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
    // OpenAI
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    // Anthropic
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    // GitHub classic/fine-grained tokens
    .replace(/\bgh[pousr]_[A-Za-z0-9]{8,}\b/g, '[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, '[REDACTED]')
    // Google
    .replace(/\bAIza[0-9A-Za-z_-]{8,}\b/g, '[REDACTED]')
    // xAI
    .replace(/\bxai-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    // Slack
    .replace(/\bxox[pbar]-[A-Za-z0-9-]+\b/g, '[REDACTED]')
    // Authorization / Bearer header values
    .replace(/\b(Authorization|Bearer)\s*[:=]?\s*[A-Za-z0-9._-]{8,}/gi, '$1 [REDACTED]')
    // JWT-like three-segment tokens
    .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
    // PEM private key blocks
    .replace(/-----BEGIN[^-]+PRIVATE KEY-----[\s\S]*?-----END[^-]+PRIVATE KEY-----/g, '[REDACTED]')
    // AWS access key identifiers
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED]')
    // common key/value forms (api_key, apiKey, token, secret, client_secret, access_key, password)
    .replace(
      /\b(api[_-]?key|token|secret|client[_-]?secret|access[_-]?key|password)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{6,}["']?/gi,
      '$1=[REDACTED]',
    );
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
