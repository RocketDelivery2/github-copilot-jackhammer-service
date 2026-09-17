import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runKnightsRoundOneCli } from '../cli/knights-round-one.js';
import { PROVIDER_LIMITS, type ProviderId, type ProviderRequest, type ProviderResult } from '../providers/types.js';
import type { RoundOneRegistryLike, TaskCharterInput } from './types.js';

const MODELS = {
  openaiModel: 'gpt-5.6-sol',
  anthropicModel: 'claude-sonnet-4-6',
  geminiModel: 'gemini-3.5-flash-lite',
} as const;

test('aggregate rendered prompt validation rejects an accepted field set before any provider invocation', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-aggregate-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'packet.json');
  const oversizedCharter: TaskCharterInput = {
    ...roundOneCharterInput(),
    objective: 'o'.repeat(2_000),
    context: 'c'.repeat(PROVIDER_LIMITS.maxPromptLength - 1_000),
  };
  await writeFile(charterPath, JSON.stringify(oversizedCharter), 'utf8');

  const callLog: ProviderId[] = [];
  const stderr: string[] = [];
  const exitCode = await runKnightsRoundOneCli(
    cliArgs(charterPath, outputPath),
    {
      registry: createRegistry(callLog),
      writeStdout: () => undefined,
      writeStderr: (text) => stderr.push(text),
    },
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(callLog, []);
  assert.match(stderr.join(''), /Rendered prompt .*100000 characters or fewer/i);
});

test('existing no-overwrite evidence is rejected atomically before provider invocation and remains unchanged', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-existing-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'packet.json');
  await writeFile(charterPath, JSON.stringify(roundOneCharterInput()), 'utf8');
  await writeFile(outputPath, 'prior evidence', 'utf8');

  const callLog: ProviderId[] = [];
  const exitCode = await runKnightsRoundOneCli(
    cliArgs(charterPath, outputPath),
    {
      registry: createRegistry(callLog),
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    },
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(callLog, []);
  assert.equal(await readFile(outputPath, 'utf8'), 'prior evidence');
});

test('provider adapters are not invoked when evidence parent directory creation fails', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-mkdir-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'blocked', 'packet.json');
  await writeFile(charterPath, JSON.stringify(roundOneCharterInput()), 'utf8');

  const callLog: ProviderId[] = [];
  const failingMkdir = (async () => {
    throw new Error('directory creation denied');
  }) as typeof mkdir;

  const exitCode = await runKnightsRoundOneCli(
    cliArgs(charterPath, outputPath),
    {
      registry: createRegistry(callLog),
      mkdir: failingMkdir,
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(callLog, []);
});

test('provider adapters are not invoked when evidence reservation fails', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-reserve-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'packet.json');
  await writeFile(charterPath, JSON.stringify(roundOneCharterInput()), 'utf8');

  const callLog: ProviderId[] = [];
  const failingWriteFile = (async () => {
    const error = new Error('reservation denied') as Error & { code?: string };
    error.code = 'EACCES';
    throw error;
  }) as typeof writeFile;

  const exitCode = await runKnightsRoundOneCli(
    cliArgs(charterPath, outputPath),
    {
      registry: createRegistry(callLog),
      writeFile: failingWriteFile,
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(callLog, []);
});

test('successful overwrite finalizes one evidence packet with no reservation artifact left behind', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-overwrite-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'packet.json');
  await writeFile(charterPath, JSON.stringify(roundOneCharterInput()), 'utf8');
  await writeFile(outputPath, 'prior evidence', 'utf8');

  const callLog: ProviderId[] = [];
  const exitCode = await runKnightsRoundOneCli(
    [...cliArgs(charterPath, outputPath), '--overwrite'],
    {
      registry: createRegistry(callLog),
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(callLog, ['openai', 'anthropic', 'gemini']);
  const packet = JSON.parse(await readFile(outputPath, 'utf8')) as { providers: unknown[] };
  assert.equal(packet.providers.length, 3);
  const files = await readdir(tempDir);
  assert.equal(files.some((name) => name.startsWith('.packet.json.') && name.endsWith('.tmp')), false);
});

test('overwrite finalization failure cleans temporary reservation and preserves prior evidence', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-finalize-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'packet.json');
  await writeFile(charterPath, JSON.stringify(roundOneCharterInput()), 'utf8');
  await writeFile(outputPath, 'prior evidence', 'utf8');

  const callLog: ProviderId[] = [];
  const failingRename = (async () => {
    throw new Error('finalization denied');
  }) as typeof rename;

  const exitCode = await runKnightsRoundOneCli(
    [...cliArgs(charterPath, outputPath), '--overwrite'],
    {
      registry: createRegistry(callLog),
      rename: failingRename,
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    },
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(callLog, ['openai', 'anthropic', 'gemini']);
  assert.equal(await readFile(outputPath, 'utf8'), 'prior evidence');
  const files = await readdir(tempDir);
  assert.equal(files.some((name) => name.startsWith('.packet.json.') && name.endsWith('.tmp')), false);
});

test('--include-response-text exposes redacted text only while preserving the raw response hash', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'knights-round-one-privacy-'));
  const charterPath = path.join(tempDir, 'charter.json');
  const outputPath = path.join(tempDir, 'packet.json');
  await writeFile(charterPath, JSON.stringify(roundOneCharterInput()), 'utf8');

  const rawSecret = ['sk-', 'sensitive', '-', 'credential', '-', '1234567890'].join('');
  const rawResponse = `ordinary prefix ${rawSecret} ordinary suffix`;
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runKnightsRoundOneCli(
    [...cliArgs(charterPath, outputPath), '--include-response-text'],
    {
      registry: createRegistry([], rawResponse),
      writeStdout: (text) => stdout.push(text),
      writeStderr: (text) => stderr.push(text),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, []);
  const stdoutText = stdout.join('');
  assert.equal(stdoutText.includes(rawSecret), false);
  assert.match(stdoutText, /\[REDACTED\]/);

  const summary = JSON.parse(stdoutText) as {
    providers: Array<{ responseText?: string }>;
  };
  assert.equal(summary.providers.every((provider) => provider.responseText?.includes('[REDACTED]') === true), true);

  const persistedText = await readFile(outputPath, 'utf8');
  assert.equal(persistedText.includes(rawSecret), false);
  assert.match(persistedText, /\[REDACTED\]/);

  const packet = JSON.parse(persistedText) as {
    providers: Array<{ rawResponseSha256: string }>;
  };
  assert.equal(packet.providers[0]?.rawResponseSha256, sha256(rawResponse));
});

function cliArgs(charterPath: string, outputPath: string): string[] {
  return [
    '--charter-file',
    charterPath,
    '--openai-model',
    MODELS.openaiModel,
    '--anthropic-model',
    MODELS.anthropicModel,
    '--gemini-model',
    MODELS.geminiModel,
    '--evidence-output',
    outputPath,
  ];
}

function roundOneCharterInput(): TaskCharterInput {
  return {
    id: 'round-one-hardening',
    title: 'Round One hardening validation',
    objective: 'Validate aggregate prompt bounds and evidence output safety.',
    context: 'Local-only test charter.',
    constraints: ['No fallback', 'No retries', 'No cross-provider sharing'],
    questions: ['What should be verified first?'],
    maxOutputTokens: 64,
    timeoutMs: 30_000,
  };
}

function createRegistry(callLog: ProviderId[], responseText = 'provider response'): RoundOneRegistryLike {
  return {
    get(providerId: ProviderId) {
      return {
        async invoke(request: ProviderRequest): Promise<ProviderResult> {
          callLog.push(providerId);
          return {
            provider: providerId,
            model: request.model,
            text: responseText,
            success: true,
            inputTokens: 11,
            outputTokens: 13,
            totalTokens: 24,
            estimatedCostUsd: null,
            latencyMs: 12,
            requestId: `${providerId}-hardening-request`,
            errorCode: null,
          };
        },
      };
    },
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
