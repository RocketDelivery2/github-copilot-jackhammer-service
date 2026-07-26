/**
 * Runs external commands in a child process with timeout, captures stdout/stderr,
 * and converts the raw result into typed execution events and queue signals.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { classifyExecutionSignals, pushUniqueSignal } from './signals.js';
import type { ExecutionEvent, QueueSignal } from './types.js';

export type CommandExecutionRequest = {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  workItemId?: string;
};

export type CommandExecutionResult = {
  command: string;
  executable: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  timedOut: boolean;
  timeoutMs?: number;
  workItemId?: string;
};

export type CommandResultConversionOptions = {
  workItemId?: string;
};

export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

export async function executeCommandCapture(
  request: CommandExecutionRequest,
): Promise<CommandExecutionResult> {
  const args = [...(request.args ?? [])];
  const cwd = path.resolve(request.cwd ?? process.cwd());
  const timeoutMs = normalizeTimeoutMs(request.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
  const startedEpochMs = Date.now();
  const startedAt = new Date(startedEpochMs).toISOString();
  const displayCommand = formatCommand(request.command, args);

  return new Promise<CommandExecutionResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(request.command, args, {
      cwd,
      env: request.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      stderr = stderr ? `${stderr}${error.message}` : error.message;
      complete(null);
    });

    child.on('close', (code) => {
      complete(code);
    });

    function complete(exitCode: number | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      const completedEpochMs = Date.now();
      resolve({
        command: displayCommand,
        executable: request.command,
        args,
        cwd,
        stdout,
        stderr,
        exitCode,
        startedAt,
        completedAt: new Date(completedEpochMs).toISOString(),
        durationMs: Math.max(0, completedEpochMs - startedEpochMs),
        timedOut,
        timeoutMs,
        workItemId: request.workItemId,
      });
    }
  });
}

export function commandResultToExecutionEvents(
  result: CommandExecutionResult,
  options: CommandResultConversionOptions = {},
): ExecutionEvent[] {
  const workItemId = resolveWorkItemId(result, options);
  const events: ExecutionEvent[] = [{
    workItemId,
    kind: 'started',
    message: `Started command: ${result.command}`,
  }];

  if (result.stdout) {
    events.push({
      workItemId,
      kind: 'stdout',
      stdout: result.stdout,
    });
  }

  if (result.stderr) {
    events.push({
      workItemId,
      kind: 'stderr',
      stderr: result.stderr,
    });
  }

  events.push({
    workItemId,
    kind: 'exit',
    exitCode: result.exitCode ?? undefined,
    message: exitMessage(result),
  });

  events.push({
    workItemId,
    kind: result.exitCode === 0 && !result.timedOut ? 'completed' : 'failed',
    exitCode: result.exitCode ?? undefined,
    message: completionMessage(result),
  });

  return events;
}

export function commandResultToQueueSignals(
  result: CommandExecutionResult,
  options: CommandResultConversionOptions = {},
): QueueSignal[] {
  const workItemId = resolveWorkItemId(result, options);
  const signals = classifyExecutionSignals({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? undefined,
    workItemId,
  });

  if (result.timedOut) {
    pushUniqueSignal(signals, {
      kind: 'blocker',
      severity: 'error',
      message: `Command timed out after ${result.timeoutMs ?? 0}ms.`,
      workItemId,
      evidence: commandEvidence(result),
    });
  } else if (result.exitCode !== null && result.exitCode !== 0 && signals.length === 0) {
    pushUniqueSignal(signals, {
      kind: 'blocker',
      severity: 'error',
      message: `Command exited with code ${result.exitCode}.`,
      workItemId,
      evidence: commandEvidence(result),
    });
  }

  return signals;
}

function normalizeTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number.');
  }

  return Math.floor(timeoutMs);
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(formatCommandPart).join(' ');
}

function formatCommandPart(part: string): string {
  if (/^[A-Za-z0-9_./:\\=-]+$/.test(part)) return part;
  return JSON.stringify(part);
}

function resolveWorkItemId(
  result: CommandExecutionResult,
  options: CommandResultConversionOptions,
): string {
  return options.workItemId ?? result.workItemId ?? `command:${result.command}`;
}

function exitMessage(result: CommandExecutionResult): string {
  if (result.timedOut) return `Command timed out after ${result.timeoutMs ?? 0}ms.`;
  if (result.exitCode === null) return 'Command exited without an exit code.';
  return `Command exited with code ${result.exitCode}.`;
}

function completionMessage(result: CommandExecutionResult): string {
  if (result.exitCode === 0 && !result.timedOut) return 'Command completed successfully.';
  return exitMessage(result);
}

function commandEvidence(result: CommandExecutionResult): string {
  const evidence = [result.stderr, result.stdout, result.command].filter(Boolean).join('\n');
  const trimmed = evidence.trim().replace(/\s+/g, ' ');
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}

