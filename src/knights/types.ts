import type { ProviderId } from '../providers/types.js';
import type { DerivedTextFinding } from './agreement-analysis.js';

export const ROUND_ONE_PACKET_VERSION = 'round-one-v1' as const;

export const ROUND_ONE_PROVIDER_ORDER: readonly ProviderId[] = ['openai', 'anthropic', 'gemini'];

export interface TaskCharterInput {
  id: string;
  title: string;
  objective: string;
  context: string;
  constraints: string[];
  questions: string[];
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface TaskCharterRuntime extends TaskCharterInput {
  providers: Record<ProviderId, { model: string }>;
}

export interface RoundOneProviderPacketResult {
  provider: ProviderId;
  model: string;
  success: boolean;
  redactedResponseText: string;
  rawResponseSha256: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  requestId: string | null;
  errorCode: string | null;
}

export interface RoundOneAnalysisInput {
  provider: ProviderId;
  success: boolean;
  responseText: string;
}

export interface RoundOneAnalysisResult {
  agreements: Array<DerivedTextFinding & { providers: ProviderId[] }>;
  disagreements: Array<{
    source: 'DERIVED';
    providerTexts: Partial<Record<ProviderId, string>>;
  }>;
  verificationRequiredItems: DerivedTextFinding[];
  proposedNextActions: DerivedTextFinding[];
  humanDecision: 'pending';
}

export interface RoundOneEvidencePacket {
  packetVersion: typeof ROUND_ONE_PACKET_VERSION;
  runId: string;
  taskCharterId: string;
  startedAt: string;
  completedAt: string;
  overallStatus: 'complete' | 'partial' | 'failed';
  taskCharter: TaskCharterRuntime;
  providers: RoundOneProviderPacketResult[];
  analysis: RoundOneAnalysisResult;
}

export interface RoundOneExecutionDependencies {
  registry?: RoundOneRegistryLike;
  runId?: string;
  now?: () => Date;
}

export interface RoundOneRegistryLike {
  get(providerId: ProviderId): {
    invoke(request: {
      prompt: string;
      model: string;
      maxOutputTokens: number;
      timeoutMs: number;
    }): Promise<{
      provider: ProviderId;
      model: string;
      text: string;
      success: boolean;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      estimatedCostUsd: number | null;
      latencyMs: number;
      requestId: string | null;
      errorCode: string | null;
    }>;
  };
}
