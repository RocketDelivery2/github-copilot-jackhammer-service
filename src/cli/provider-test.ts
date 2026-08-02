import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProviderId, ProviderResult } from '../providers/types.js';
import { providerRegistry, type ProviderRegistry } from '../providers/registry.js';

export interface ProviderTestCliOptions {
  provider: ProviderId;
  model: string;
  prompt: string;
  maxOutputTokens: number;
  timeoutMs: number;
  showText: boolean;
}

export interface ProviderTestCliDependencies {
  registry?: ProviderRegistry;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
}

export function parseProviderTestArgs(argv: readonly string[]): ProviderTestCliOptions {
  let provider: ProviderId | null = null;
  let model = '';
  let prompt = '';
  let maxOutputTokens = 64;
  let timeoutMs = 30_000;
  let showText = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith('--provider=')) {
      provider = parseProviderId(argument.slice('--provider='.length));
      continue;
    }

    if (argument.startsWith('--model=')) {
      model = argument.slice('--model='.length);
      continue;
    }

    if (argument.startsWith('--prompt=')) {
      prompt = argument.slice('--prompt='.length);
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
      case '--provider':
        provider = parseProviderId(requireNext(argv, ++index, '--provider'));
        break;
      case '--model':
        model = requireNext(argv, ++index, '--model');
        break;
      case '--prompt':
        prompt = requireNext(argv, ++index, '--prompt');
        break;
      case '--max-output-tokens':
        maxOutputTokens = parsePositiveInteger(requireNext(argv, ++index, '--max-output-tokens'), '--max-output-tokens');
        break;
      case '--timeout-ms':
        timeoutMs = parsePositiveInteger(requireNext(argv, ++index, '--timeout-ms'), '--timeout-ms');
        break;
      case '--show-text':
        showText = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!provider) {
    throw new Error('Missing required --provider.');
  }

  if (model.trim().length === 0) {
    throw new Error('Missing required --model.');
  }

  if (prompt.trim().length === 0) {
    throw new Error('Missing required --prompt.');
  }

  return {
    provider,
    model,
    prompt,
    maxOutputTokens,
    timeoutMs,
    showText,
  };
}

export function formatProviderResult(result: ProviderResult, showText: boolean): Record<string, unknown> {
  return {
    provider: result.provider,
    model: result.model,
    success: result.success,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
    estimatedCostUsd: result.estimatedCostUsd,
    latencyMs: result.latencyMs,
    requestId: result.requestId,
    errorCode: result.errorCode,
    responseTextLength: result.text.length,
    ...(showText ? { text: result.text } : {}),
  };
}

export async function runProviderTestCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: ProviderTestCliDependencies = {},
): Promise<number> {
  const writeStdout = dependencies.writeStdout ?? ((text: string) => process.stdout.write(text));
  const writeStderr = dependencies.writeStderr ?? ((text: string) => process.stderr.write(text));
  let options: ProviderTestCliOptions;

  try {
    options = parseProviderTestArgs(argv);
  } catch (error) {
    writeStderr(`${formatCliError(error)}\n`);
    return 2;
  }

  const registry = dependencies.registry ?? providerRegistry;

  try {
    const adapter = registry.get(options.provider);
    const result = await adapter.invoke({
      prompt: options.prompt,
      model: options.model,
      maxOutputTokens: options.maxOutputTokens,
      timeoutMs: options.timeoutMs,
    });

    writeStdout(`${JSON.stringify(formatProviderResult(result, options.showText), null, 2)}\n`);
    return result.success ? 0 : 1;
  } catch (error) {
    const fallbackResult: ProviderResult = {
      provider: options.provider,
      model: options.model,
      text: '',
      success: false,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
      latencyMs: 0,
      requestId: null,
      errorCode: 'cli_failure',
    };

    writeStdout(`${JSON.stringify(formatProviderResult(fallbackResult, options.showText), null, 2)}\n`);
    writeStderr(`${formatCliError(error)}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  const exitCode = await runProviderTestCli();
  process.exitCode = exitCode;
}

if (isDirectExecution()) {
  void main().catch((error) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}

function parseProviderId(value: string): ProviderId {
  const trimmed = value.trim();
  if (trimmed === 'openai' || trimmed === 'anthropic' || trimmed === 'gemini') {
    return trimmed;
  }

  throw new Error(`Unsupported provider: ${value}`);
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

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  return pathToFileURL(path.resolve(entryPoint)).href === import.meta.url;
}
