import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { providerRegistry } from '../providers/registry.js';
import { resolveTaskCharterRuntime, type TaskCharterInput } from '../knights/task-charter.js';
import { executeRoundOne } from '../knights/round-one.js';
import type { RoundOneEvidencePacket, RoundOneRegistryLike, TaskCharterRuntime } from '../knights/types.js';

export interface KnightsRoundOneCliOptions {
  charterFile: string;
  openaiModel: string;
  anthropicModel: string;
  geminiModel: string;
  evidenceOutput: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  includeResponseText: boolean;
  overwrite: boolean;
}

export interface KnightsRoundOneCliDependencies {
  registry?: RoundOneRegistryLike;
  readFile?: typeof readFile;
  writeFile?: typeof writeFile;
  mkdir?: typeof mkdir;
  stat?: typeof stat;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
}

export function parseKnightsRoundOneArgs(argv: readonly string[]): KnightsRoundOneCliOptions {
  let charterFile = '';
  let openaiModel = '';
  let anthropicModel = '';
  let geminiModel = '';
  let evidenceOutput = 'round-one-evidence.json';
  let maxOutputTokens: number | undefined;
  let timeoutMs: number | undefined;
  let includeResponseText = false;
  let overwrite = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith('--charter-file=')) {
      charterFile = argument.slice('--charter-file='.length);
      continue;
    }

    if (argument.startsWith('--openai-model=')) {
      openaiModel = argument.slice('--openai-model='.length);
      continue;
    }

    if (argument.startsWith('--anthropic-model=')) {
      anthropicModel = argument.slice('--anthropic-model='.length);
      continue;
    }

    if (argument.startsWith('--gemini-model=')) {
      geminiModel = argument.slice('--gemini-model='.length);
      continue;
    }

    if (argument.startsWith('--evidence-output=')) {
      evidenceOutput = argument.slice('--evidence-output='.length);
      continue;
    }

    if (argument.startsWith('--max-output-tokens=')) {
      maxOutputTokens = parsePositiveInteger(argument.slice('--max-output-tokens='.length), '--max-output-tokens');
      continue;
    }

    if (argument.startsWith('--timeout-ms=')) {
      timeoutMs = parsePositiveInteger(argument.slice('--timeout-ms='.length), '--timeout-ms');
      continue;
    }

    switch (argument) {
      case '--charter-file':
        charterFile = requireNext(argv, ++index, '--charter-file');
        break;
      case '--openai-model':
        openaiModel = requireNext(argv, ++index, '--openai-model');
        break;
      case '--anthropic-model':
        anthropicModel = requireNext(argv, ++index, '--anthropic-model');
        break;
      case '--gemini-model':
        geminiModel = requireNext(argv, ++index, '--gemini-model');
        break;
      case '--evidence-output':
        evidenceOutput = requireNext(argv, ++index, '--evidence-output');
        break;
      case '--max-output-tokens':
        maxOutputTokens = parsePositiveInteger(requireNext(argv, ++index, '--max-output-tokens'), '--max-output-tokens');
        break;
      case '--timeout-ms':
        timeoutMs = parsePositiveInteger(requireNext(argv, ++index, '--timeout-ms'), '--timeout-ms');
        break;
      case '--include-response-text':
        includeResponseText = true;
        break;
      case '--overwrite':
        overwrite = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (charterFile.trim().length === 0) {
    throw new Error('Missing required --charter-file.');
  }

  if (openaiModel.trim().length === 0) {
    throw new Error('Missing required --openai-model.');
  }

  if (anthropicModel.trim().length === 0) {
    throw new Error('Missing required --anthropic-model.');
  }

  if (geminiModel.trim().length === 0) {
    throw new Error('Missing required --gemini-model.');
  }

  return {
    charterFile,
    openaiModel,
    anthropicModel,
    geminiModel,
    evidenceOutput,
    maxOutputTokens,
    timeoutMs,
    includeResponseText,
    overwrite,
  };
}

export async function runKnightsRoundOneCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: KnightsRoundOneCliDependencies = {},
): Promise<number> {
  const writeStdout = dependencies.writeStdout ?? ((text: string) => process.stdout.write(text));
  const writeStderr = dependencies.writeStderr ?? ((text: string) => process.stderr.write(text));
  const readFileImpl = dependencies.readFile ?? readFile;
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  const statImpl = dependencies.stat ?? stat;
  const registry = dependencies.registry ?? providerRegistry;

  let options: KnightsRoundOneCliOptions;
  try {
    options = parseKnightsRoundOneArgs(argv);
  } catch (error) {
    writeStderr(`${formatCliError(error)}\n`);
    return 2;
  }

  let charterInput: TaskCharterInput;
  try {
    charterInput = JSON.parse(await readFileImpl(options.charterFile, 'utf8')) as TaskCharterInput;
  } catch (error) {
    writeStderr(`${formatCliError(error)}\n`);
    return 2;
  }

  let charterRuntime: TaskCharterRuntime;
  try {
    charterRuntime = resolveTaskCharterRuntime(
      charterInput,
      {
        openaiModel: options.openaiModel,
        anthropicModel: options.anthropicModel,
        geminiModel: options.geminiModel,
      },
      {
        maxOutputTokens: options.maxOutputTokens,
        timeoutMs: options.timeoutMs,
      },
    );
  } catch (error) {
    writeStderr(`${formatCliError(error)}\n`);
    return 2;
  }

  const outputPath = path.resolve(options.evidenceOutput);
  if (!options.overwrite) {
    try {
      await statImpl(outputPath);
      writeStderr(`Evidence file already exists: ${outputPath}\n`);
      return 2;
    } catch (error) {
      if (!isMissingFileError(error)) {
        writeStderr(`${formatCliError(error)}\n`);
        return 1;
      }
    }
  }

  const packet = await executeRoundOne(charterRuntime, { registry });
  const serializedPacket = `${JSON.stringify(packet, null, 2)}\n`;

  try {
    await mkdirImpl(path.dirname(outputPath), { recursive: true });
    await writeFileImpl(outputPath, serializedPacket, { encoding: 'utf8', flag: options.overwrite ? 'w' : 'wx' });
  } catch (error) {
    writeStderr(`${formatCliError(error)}\n`);
    return 1;
  }

  writeStdout(`${JSON.stringify(formatCliSummary(packet, options.includeResponseText), null, 2)}\n`);
  return packet.overallStatus === 'complete' ? 0 : 1;
}

export function formatCliSummary(packet: RoundOneEvidencePacket, includeResponseText: boolean): Record<string, unknown> {
  return {
    packetVersion: packet.packetVersion,
    runId: packet.runId,
    taskCharterId: packet.taskCharterId,
    startedAt: packet.startedAt,
    completedAt: packet.completedAt,
    overallStatus: packet.overallStatus,
    providers: packet.providers.map((result) => ({
      provider: result.provider,
      model: result.model,
      success: result.success,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      latencyMs: result.latencyMs,
      requestId: result.requestId,
      errorCode: result.errorCode,
      responseTextLength: result.redactedResponseText.length,
      ...(includeResponseText ? { responseText: result.redactedResponseText } : {}),
    })),
    analysis: {
      agreements: packet.analysis.agreements.length,
      disagreements: packet.analysis.disagreements.length,
      verificationRequiredItems: packet.analysis.verificationRequiredItems.length,
      proposedNextActions: packet.analysis.proposedNextActions.length,
      humanDecision: packet.analysis.humanDecision,
    },
  };
}

async function main(): Promise<void> {
  const exitCode = await runKnightsRoundOneCli();
  process.exitCode = exitCode;
}

if (isDirectExecution()) {
  void main().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flagName}.`);
  }

  return parsed;
}

function requireNext(argv: readonly string[], index: number, flagName: string): string {
  const next = argv[index];
  if (typeof next !== 'string' || next.trim().length === 0) {
    throw new Error(`Missing value for ${flagName}.`);
  }

  return next;
}

function formatCliError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Invalid command arguments.';
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === 'object'
    && Reflect.get(error as object, 'code') === 'ENOENT';
}

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  return pathToFileURL(path.resolve(entryPoint)).href === import.meta.url;
}
