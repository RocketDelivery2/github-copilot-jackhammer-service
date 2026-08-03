import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ProviderId, ProviderRequest, ProviderResult } from '../providers/types.js';
import { analyzeRoundOneResponses } from './agreement-analysis.js';
import { buildRoundOnePrompt, executeRoundOne } from './round-one.js';
import { parseTaskCharterInput, resolveTaskCharterRuntime, type TaskCharterInput } from './task-charter.js';

test('imports knights modules without provider credentials', async () => {
  await withEnv(
    {
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    },
    async () => {
      await import('./round-one.js');
      await import('./task-charter.js');
      await import('../cli/knights-round-one.js');
    },
  );
});

test('task charter validation rejects malformed input and bounds violations', () => {
  assert.throws(() => parseTaskCharterInput('{'), /Unexpected token|Expected property name/);
  assert.throws(
    () =>
      parseTaskCharterInput(
        JSON.stringify({
          id: 'round-1',
          title: 'x',
          objective: 'y',
          context: 'z',
          constraints: [],
          questions: [],
          maxOutputTokens: 0,
          timeoutMs: 1,
        }),
      ),
    /maxOutputTokens/i,
  );
});

test('explicit model assignment is preserved in the resolved task charter', () => {
  const charter = resolveTaskCharterRuntime(
    {
      id: 'round-1',
      title: 'Round One',
      objective: 'Validate provider isolation',
      context: 'Local only.',
      constraints: ['No fallback'],
      questions: ['What changed?'],
      maxOutputTokens: 64,
      timeoutMs: 30_000,
    },
    {
      openaiModel: 'gpt-5.6-sol',
      anthropicModel: 'claude-sonnet-4-6',
      geminiModel: 'gemini-3.5-flash-lite',
    },
  );

  assert.equal(charter.providers.openai.model, 'gpt-5.6-sol');
  assert.equal(charter.providers.anthropic.model, 'claude-sonnet-4-6');
  assert.equal(charter.providers.gemini.model, 'gemini-3.5-flash-lite');
});

test('the round-one prompt does not contain mojibake and uses an ASCII hyphen', () => {
  const prompt = buildRoundOnePrompt(roundOneCharter(), 'openai');
  assert.equal(prompt.includes('—'), false);
  assert.match(prompt, /Knights of the Round Table - Round 1 task charter/);
});

test('executeRoundOne invokes exactly one bounded request per provider', async () => {
  const callLog: ProviderId[] = [];
  const charter = roundOneCharter();
  const packet = await executeRoundOne(charter, {
    runId: 'run-1',
    registry: createMockRegistry({
      openai: createSuccessAdapter('openai', callLog, 'openai-response'),
      anthropic: createSuccessAdapter('anthropic', callLog, 'anthropic-response'),
      gemini: createSuccessAdapter('gemini', callLog, 'gemini-response'),
    }),
    now: fixedClock('2026-08-02T12:00:00.000Z', '2026-08-02T12:00:05.000Z'),
  });

  assert.deepEqual(callLog, ['openai', 'anthropic', 'gemini']);
  assert.equal(packet.providers.length, 3);
  assert.equal(packet.overallStatus, 'complete');
});

test('executeRoundOne does not fall back or retry another provider', async () => {
  const callLog: ProviderId[] = [];
  const packet = await executeRoundOne(roundOneCharter(), {
    registry: createMockRegistry({
      openai: createFailureAdapter('openai', callLog, 'openai failed'),
      anthropic: createSuccessAdapter('anthropic', callLog, 'anthropic-response'),
      gemini: createSuccessAdapter('gemini', callLog, 'gemini-response'),
    }),
  });

  assert.deepEqual(callLog, ['openai', 'anthropic', 'gemini']);
  assert.equal(packet.providers.find((result) => result.provider === 'openai')?.success, false);
  assert.equal(packet.providers.find((result) => result.provider === 'anthropic')?.success, true);
  assert.equal(packet.providers.find((result) => result.provider === 'gemini')?.success, true);
});

test('executeRoundOne preserves each provider response and preserves token metadata', async () => {
  const packet = await executeRoundOne(roundOneCharter(), {
    registry: createMockRegistry({
      openai: createSuccessAdapter('openai', undefined, 'openai text'),
      anthropic: createSuccessAdapter('anthropic', undefined, 'anthropic text'),
      gemini: createSuccessAdapter('gemini', undefined, 'gemini text'),
    }),
  });

  const openai = packet.providers.find((result) => result.provider === 'openai');
  const anthropic = packet.providers.find((result) => result.provider === 'anthropic');
  const gemini = packet.providers.find((result) => result.provider === 'gemini');

  assert.equal(openai?.redactedResponseText, 'openai text');
  assert.equal(openai?.rawResponseSha256, sha256('openai text'));
  assert.equal(anthropic?.redactedResponseText, 'anthropic text');
  assert.equal(anthropic?.rawResponseSha256, sha256('anthropic text'));
  assert.equal(gemini?.redactedResponseText, 'gemini text');
  assert.equal(gemini?.rawResponseSha256, sha256('gemini text'));
  assert.equal(openai?.inputTokens, 11);
  assert.equal(openai?.outputTokens, 13);
  assert.equal(openai?.totalTokens, 24);
  assert.equal(openai?.latencyMs, 12);
  assert.equal(openai?.requestId, 'openai-request-1');
  assert.equal(openai?.errorCode, null);
});

test('executeRoundOne normalizes provider failures without suppressing other results', async () => {
  const packet = await executeRoundOne(roundOneCharter(), {
    registry: createMockRegistry({
      openai: createSuccessAdapter('openai', undefined, 'openai text'),
      anthropic: createFailureAdapter('anthropic', undefined, 'anthropic timeout'),
      gemini: createSuccessAdapter('gemini', undefined, 'gemini text'),
    }),
  });

  assert.equal(packet.overallStatus, 'partial');
  assert.equal(packet.providers.find((result) => result.provider === 'anthropic')?.success, false);
  assert.equal(packet.providers.find((result) => result.provider === 'anthropic')?.errorCode, 'timeout');
  assert.equal(packet.providers.find((result) => result.provider === 'openai')?.success, true);
  assert.equal(packet.providers.find((result) => result.provider === 'gemini')?.success, true);
});

test('a thrown OpenAI adapter failure does not suppress Anthropic or Gemini', async () => {
  const callLog: ProviderId[] = [];
  const packet = await executeRoundOne(roundOneCharter(), {
    registry: createMockRegistry({
      openai: createThrowingAdapter('openai', callLog, 'openai rejected'),
      anthropic: createSuccessAdapter('anthropic', callLog, 'anthropic-response'),
      gemini: createSuccessAdapter('gemini', callLog, 'gemini-response'),
    }),
  });

  assert.deepEqual(callLog, ['openai', 'anthropic', 'gemini']);
  assert.equal(packet.overallStatus, 'partial');
  assert.equal(packet.providers.find((result) => result.provider === 'openai')?.success, false);
  assert.equal(packet.providers.find((result) => result.provider === 'openai')?.errorCode, 'provider_error');
});

test('a thrown Anthropic adapter failure does not suppress OpenAI or Gemini', async () => {
  const callLog: ProviderId[] = [];
  const packet = await executeRoundOne(roundOneCharter(), {
    registry: createMockRegistry({
      openai: createSuccessAdapter('openai', callLog, 'openai-response'),
      anthropic: createThrowingAdapter('anthropic', callLog, 'anthropic rejected'),
      gemini: createSuccessAdapter('gemini', callLog, 'gemini-response'),
    }),
  });

  assert.deepEqual(callLog, ['openai', 'anthropic', 'gemini']);
  assert.equal(packet.overallStatus, 'partial');
  assert.equal(packet.providers.find((result) => result.provider === 'anthropic')?.success, false);
  assert.equal(packet.providers.find((result) => result.provider === 'anthropic')?.errorCode, 'provider_error');
});

test('a thrown Gemini adapter failure does not suppress OpenAI or Anthropic', async () => {
  const callLog: ProviderId[] = [];
  const packet = await executeRoundOne(roundOneCharter(), {
    registry: createMockRegistry({
      openai: createSuccessAdapter('openai', callLog, 'openai-response'),
      anthropic: createSuccessAdapter('anthropic', callLog, 'anthropic-response'),
      gemini: createThrowingAdapter('gemini', callLog, 'gemini rejected'),
    }),
  });

  assert.deepEqual(callLog, ['openai', 'anthropic', 'gemini']);
  assert.equal(packet.overallStatus, 'partial');
  assert.equal(packet.providers.find((result) => result.provider === 'gemini')?.success, false);
  assert.equal(packet.providers.find((result) => result.provider === 'gemini')?.errorCode, 'provider_error');
});

test('agreement analysis is conservative and deterministic', () => {
  const analysis = analyzeRoundOneResponses([
    makePacket('openai', 'keep work local.\nnext action: inspect charter.\nneeds verification: branch state.'),
    makePacket('anthropic', 'keep work local.\nnext action: inspect charter.\nneeds verification: branch state.'),
    makePacket('gemini', 'do not keep work local.\nnext action: inspect charter.\nneeds verification: branch state.'),
  ]);

  assert.equal(analysis.humanDecision, 'pending');
  assert.equal(analysis.agreements.length >= 1, true);
  assert.match(JSON.stringify(analysis.agreements), /keep work local/);
  assert.equal(analysis.disagreements.length >= 1, true);
  assert.match(JSON.stringify(analysis.disagreements), /keep work local/);
  assert.equal(analysis.verificationRequiredItems.length >= 1, true);
  assert.equal(analysis.proposedNextActions.length >= 1, true);
});

test('secret-like content is redacted from the evidence packet', async () => {
  const packet = await executeRoundOne(roundOneCharter(), {
    registry: createMockRegistry({
      openai: createSuccessAdapter('openai', undefined, 'token sk-test-secret-1234567890 should be hidden'),
      anthropic: createSuccessAdapter('anthropic', undefined, 'anthropic text'),
      gemini: createSuccessAdapter('gemini', undefined, 'gemini text'),
    }),
  });

  const openai = packet.providers.find((result) => result.provider === 'openai');
  assert.equal(openai?.redactedResponseText.includes('sk-test-secret-1234567890'), false);
  assert.equal(openai?.redactedResponseText.includes('[REDACTED]'), true);
  assert.equal(openai?.rawResponseSha256, sha256('token sk-test-secret-1234567890 should be hidden'));
});

test('the CLI keeps response text out of the console by default and writes evidence locally', async () => {
  const { runKnightsRoundOneCli } = await import('../cli/knights-round-one.js');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'packet.json');
  await writeFile(charterPath, JSON.stringify(roundOneCharterInput()), 'utf8');

  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runKnightsRoundOneCli(
    [
      '--charter-file',
      charterPath,
      '--openai-model',
      'gpt-5.6-sol',
      '--anthropic-model',
      'claude-sonnet-4-6',
      '--gemini-model',
      'gemini-3.5-flash-lite',
      '--evidence-output',
      outputPath,
    ],
    {
      registry: createMockRegistry({
        openai: createSuccessAdapter('openai', undefined, 'openai text'),
        anthropic: createSuccessAdapter('anthropic', undefined, 'anthropic text'),
        gemini: createSuccessAdapter('gemini', undefined, 'gemini text'),
      }),
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(stdout.join('').includes('Round 1 task charter'), false);
  assert.equal(stdout.join('').includes('openai text'), false);
  const packet = JSON.parse(await readFile(outputPath, 'utf8')) as { providers: Array<{ redactedResponseText: string; rawResponseSha256: string }> };
  assert.equal(packet.providers[0].redactedResponseText, 'openai text');
  assert.equal(packet.providers[0].rawResponseSha256, sha256('openai text'));
});

test('the CLI blocks evidence-file collisions unless overwrite is requested', async () => {
  const { runKnightsRoundOneCli } = await import('../cli/knights-round-one.js');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-collision-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'packet.json');
  await writeFile(charterPath, JSON.stringify(roundOneCharterInput()), 'utf8');
  await writeFile(outputPath, '{}', 'utf8');

  const exitCode = await runKnightsRoundOneCli(
    [
      '--charter-file',
      charterPath,
      '--openai-model',
      'gpt-5.6-sol',
      '--anthropic-model',
      'claude-sonnet-4-6',
      '--gemini-model',
      'gemini-3.5-flash-lite',
      '--evidence-output',
      outputPath,
    ],
    {
      registry: createMockRegistry({
        openai: createSuccessAdapter('openai', undefined, 'openai text'),
        anthropic: createSuccessAdapter('anthropic', undefined, 'anthropic text'),
        gemini: createSuccessAdapter('gemini', undefined, 'gemini text'),
      }),
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    },
  );

  assert.equal(exitCode, 2);
});

test('the CLI returns exit code 1 when one provider fails and the others still run', async () => {
  const { runKnightsRoundOneCli } = await import('../cli/knights-round-one.js');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-failure-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'packet.json');
  await writeFile(charterPath, JSON.stringify(roundOneCharterInput()), 'utf8');

  const exitCode = await runKnightsRoundOneCli(
    [
      '--charter-file',
      charterPath,
      '--openai-model',
      'gpt-5.6-sol',
      '--anthropic-model',
      'claude-sonnet-4-6',
      '--gemini-model',
      'gemini-3.5-flash-lite',
      '--evidence-output',
      outputPath,
    ],
    {
      registry: createMockRegistry({
        openai: createSuccessAdapter('openai', undefined, 'openai text'),
        anthropic: createFailureAdapter('anthropic', undefined, 'timeout'),
        gemini: createSuccessAdapter('gemini', undefined, 'gemini text'),
      }),
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    },
  );

  assert.equal(exitCode, 1);
});

function roundOneCharterInput(): TaskCharterInput {
  return {
    id: 'round-one-001',
    title: 'Round 1 bounded local-only foundation',
    objective: 'Collect three independent provider responses and preserve them locally.',
    context: 'Local-only task charter for provider isolation.',
    constraints: ['No fallback', 'No retries', 'No cross-provider sharing'],
    questions: ['What should be verified first?', 'What should happen next?'],
    maxOutputTokens: 64,
    timeoutMs: 30_000,
  };
}

function roundOneCharter() {
  return resolveTaskCharterRuntime(roundOneCharterInput(), {
    openaiModel: 'gpt-5.6-sol',
    anthropicModel: 'claude-sonnet-4-6',
    geminiModel: 'gemini-3.5-flash-lite',
  });
}

function createMockRegistry(adapters: Record<ProviderId, { invoke(request: ProviderRequest): Promise<ProviderResult> }>) {
  return {
    get(providerId: ProviderId) {
      return adapters[providerId];
    },
  };
}

function createSuccessAdapter(
  provider: ProviderId,
  callLog?: ProviderId[],
  text = `${provider} text`,
): { invoke(request: ProviderRequest): Promise<ProviderResult> } {
  return {
    async invoke(request: ProviderRequest): Promise<ProviderResult> {
      callLog?.push(provider);
      assert.equal(request.model, roundOneCharter().providers[provider].model);
      assert.equal(request.maxOutputTokens, 64);
      assert.equal(request.timeoutMs, 30_000);
      assert.match(request.prompt, new RegExp(`Provider: ${provider}`));
      assert.match(request.prompt, /Knights of the Round Table - Round 1 task charter/);
      return {
        provider,
        model: request.model,
        text,
        success: true,
        inputTokens: 11,
        outputTokens: 13,
        totalTokens: 24,
        estimatedCostUsd: null,
        latencyMs: 12,
        requestId: `${provider}-request-1`,
        errorCode: null,
      };
    },
  };
}

function createFailureAdapter(
  provider: ProviderId,
  callLog?: ProviderId[],
  message = `${provider} failed`,
): { invoke(request: ProviderRequest): Promise<ProviderResult> } {
  return {
    async invoke(request: ProviderRequest): Promise<ProviderResult> {
      callLog?.push(provider);
      assert.match(request.prompt, new RegExp(`Provider: ${provider}`));
      return {
        provider,
        model: request.model,
        text: '',
        success: false,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostUsd: null,
        latencyMs: 7,
        requestId: null,
        errorCode: message.includes('timeout') ? 'timeout' : 'provider_error',
      };
    },
  };
}

function createThrowingAdapter(
  provider: ProviderId,
  callLog?: ProviderId[],
  message = `${provider} rejected`,
): { invoke(request: ProviderRequest): Promise<ProviderResult> } {
  return {
    async invoke(request: ProviderRequest): Promise<ProviderResult> {
      callLog?.push(provider);
      assert.match(request.prompt, /Knights of the Round Table - Round 1 task charter/);
      throw new Error(message);
    },
  };
}

function makePacket(provider: ProviderId, text: string): { provider: ProviderId; success: boolean; responseText: string; } {
  return {
    provider,
    success: true,
    responseText: text,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fixedClock(...timestamps: string[]): () => Date {
  let index = 0;
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]);
}

async function withEnv<T>(overrides: Record<string, string | undefined>, action: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key]);
  }

  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return await action();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
