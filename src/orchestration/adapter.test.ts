import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  captureAdaptivePreviewCommandRunnerFeedback,
  captureAdaptivePreviewJournal,
  createAdaptiveQueuePreview,
  mapRuntimeInputsToQueueSignals,
  mapRuntimeInputsToWorkItems,
} from './adapter.js';
import type { AdaptiveQueueRuntimeInputs } from './adapter.js';
import {
  commandResultToExecutionEvents,
  commandResultToQueueSignals,
  executeCommandCapture,
} from './command-runner.js';
import type { CommandExecutionResult } from './command-runner.js';
import type { EventJournalRecord } from './event-journal.js';

const runtimeInputs: AdaptiveQueueRuntimeInputs = {
  activeWorkItem: {
    issueNumber: 42,
    issueUrl: 'https://github.example/issues/42',
    title: 'Implement guarded adapter',
    startedAt: '2026-06-20T12:00:00.000Z',
  },
  commandQueue: [{
    hash: 'abc123',
    title: 'Follow-up queue item',
    priority: 'medium',
    issueNumber: 43,
    issueUrl: 'https://github.example/issues/43',
    prompt: 'Ask Copilot to implement the follow-up.',
  }],
  guidance: {
    planSteps: [],
    recommendedNextPR: null,
    notes: [],
    validation: ['npm run build failed with error TS2322'],
    blockers: ['Waiting for reviewer decision.'],
    errors: [],
    hasCopilotQuestion: true,
    rawText: 'Should I continue with this adapter shape?',
    extractedAt: '2026-06-20T12:05:00.000Z',
  },
  recentResults: [{
    issueNumber: 44,
    title: 'Previous validation',
    outcome: 'error',
    summary: 'npm test failed with assertion error',
    recordedAt: '2026-06-20T12:10:00.000Z',
  }],
};

describe('adaptive queue adapter', () => {
  it('keeps legacy scheduling as the disabled default', () => {
    const preview = createAdaptiveQueuePreview(runtimeInputs, { enabled: false });

    assert.equal(preview.mode, 'legacy');
    assert.equal(preview.schedulerInvoked, false);
    assert.deepEqual(preview.workItems, []);
    assert.deepEqual(preview.executionEvents, []);
    assert.deepEqual(preview.signals, []);
    assert.deepEqual(preview.scheduledWorkItemIds, []);
  });

  it('does not invoke adaptive scheduling when disabled', () => {
    let schedulerInvoked = false;
    const preview = createAdaptiveQueuePreview(runtimeInputs, {
      enabled: false,
      scheduler: () => {
        schedulerInvoked = true;
        return [];
      },
    });

    assert.equal(schedulerInvoked, false);
    assert.equal(preview.schedulerInvoked, false);
  });

  it('maps runtime queue inputs deterministically', () => {
    const firstWorkItems = mapRuntimeInputsToWorkItems(runtimeInputs);
    const secondWorkItems = mapRuntimeInputsToWorkItems(runtimeInputs);
    const firstSignals = mapRuntimeInputsToQueueSignals(runtimeInputs);
    const secondSignals = mapRuntimeInputsToQueueSignals(runtimeInputs);

    assert.deepEqual(firstWorkItems, secondWorkItems);
    assert.deepEqual(firstSignals, secondSignals);
    assert.deepEqual(firstWorkItems.map(item => item.id), ['issue:42', 'issue:43']);
    assert.deepEqual(firstWorkItems.map(item => item.status), ['running', 'pending']);
    assert.deepEqual(firstSignals.map(signal => signal.kind), [
      'agent_question',
      'blocker',
      'build_failure',
      'test_failure',
    ]);
  });

  it('writes preview execution events to the journal when adaptive preview is enabled', async () => {
    const capture = await captureAdaptivePreviewCommandRunnerFeedback({
      enabled: true,
      requests: [{
        command: process.execPath,
        args: ['-e', 'process.stderr.write("error TS2322: Type mismatch"); process.exit(1);'],
        timeoutMs: 1_000,
        workItemId: 'validate:build',
      }],
    });
    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      executionEvents: capture.executionEvents,
      queueSignals: capture.queueSignals,
    }, { enabled: true });
    const appended: EventJournalRecord[] = [];

    await captureAdaptivePreviewJournal(preview, {
      enabled: true,
      journalPath: 'ignored.json',
      appendRecords: async (_filePath, records) => {
        appended.push(...records);
        return [...records];
      },
      now: () => '2026-06-20T12:12:00.000Z',
      source: 'adapter-test',
    });

    assert.ok(appended.some(record =>
      record.type === 'execution_event'
      && record.event.kind === 'failed'
      && record.event.workItemId === 'validate:build'));
  });

  it('writes preview queue signals to the journal when adaptive preview is enabled', async () => {
    const capture = await captureAdaptivePreviewCommandRunnerFeedback({
      enabled: true,
      requests: [{
        command: process.execPath,
        args: ['-e', 'process.stderr.write("npm test failed with assertion error"); process.exit(1);'],
        timeoutMs: 1_000,
        workItemId: 'validate:test',
      }],
    });
    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      executionEvents: capture.executionEvents,
      queueSignals: capture.queueSignals,
    }, { enabled: true });
    const appended: EventJournalRecord[] = [];

    await captureAdaptivePreviewJournal(preview, {
      enabled: true,
      journalPath: 'ignored.json',
      appendRecords: async (_filePath, records) => {
        appended.push(...records);
        return [...records];
      },
      now: () => '2026-06-20T12:14:00.000Z',
      source: 'adapter-test',
    });

    assert.ok(appended.some(record =>
      record.type === 'queue_signal'
      && record.signal.kind === 'test_failure'
      && record.signal.workItemId === 'validate:test'));
  });

  it('does not write journal records while adaptive preview is disabled', async () => {
    const preview = createAdaptiveQueuePreview(runtimeInputs, { enabled: false });
    let appendInvoked = false;

    const records = await captureAdaptivePreviewJournal(preview, {
      enabled: false,
      journalPath: 'ignored.json',
      appendRecords: async () => {
        appendInvoked = true;
        return [];
      },
    });

    assert.equal(appendInvoked, false);
    assert.deepEqual(records, []);
  });

  it('does not invoke command-runner preview capture while adaptive preview is disabled', async () => {
    let captureInvoked = false;

    const capture = await captureAdaptivePreviewCommandRunnerFeedback({
      enabled: false,
      requests: [{
        command: process.execPath,
        args: ['-e', 'process.stdout.write("ignored")'],
      }],
      executeCapture: async () => {
        captureInvoked = true;
        return buildCommandExecutionResult({
          command: 'node -e "ignored"',
          executable: process.execPath,
          args: ['-e', 'process.stdout.write("ignored")'],
          stdout: 'ignored',
          workItemId: 'issue:42',
        });
      },
    });

    assert.equal(captureInvoked, false);
    assert.deepEqual(capture.commandResults, []);
    assert.deepEqual(capture.executionEvents, []);
    assert.deepEqual(capture.queueSignals, []);
  });

  it('captures timeout failures as preview-only signals without changing disabled legacy scheduling', async () => {
    const capture = await captureAdaptivePreviewCommandRunnerFeedback({
      enabled: true,
      requests: [{
        command: process.execPath,
        args: ['-e', 'setTimeout(() => process.stdout.write("late"), 1000)'],
        timeoutMs: 50,
        workItemId: 'issue:42',
      }],
      executeCapture: async (request) => buildCommandExecutionResult({
        command: `${request.command} ${(request.args ?? []).join(' ')}`.trim(),
        executable: request.command,
        args: [...(request.args ?? [])],
        exitCode: null,
        timedOut: true,
        timeoutMs: request.timeoutMs ?? 50,
        stderr: '',
        stdout: '',
        workItemId: request.workItemId,
      }),
    });

    assert.ok(capture.queueSignals.some(signal =>
      signal.kind === 'blocker'
      && signal.severity === 'error'
      && signal.workItemId === 'issue:42'
      && /timed out/i.test(signal.message)));

    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      executionEvents: capture.executionEvents,
      queueSignals: capture.queueSignals,
    }, { enabled: false });

    assert.equal(preview.mode, 'legacy');
    assert.equal(preview.schedulerInvoked, false);
    assert.deepEqual(preview.scheduledWorkItemIds, []);
    assert.deepEqual(preview.executionEvents, []);
    assert.deepEqual(preview.signals, []);
  });

  it('uses configured journal path and retention', async () => {
    const capture = await captureAdaptivePreviewCommandRunnerFeedback({
      enabled: true,
      requests: [{
        command: process.execPath,
        args: ['-e', 'process.stderr.write("eslint failed with 1 problem"); process.exit(1);'],
        timeoutMs: 1_000,
        workItemId: 'validate:lint',
      }],
    });
    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      executionEvents: capture.executionEvents,
      queueSignals: capture.queueSignals,
    }, { enabled: true });

    let pathArg = '';
    let retentionArg: number | undefined;

    await captureAdaptivePreviewJournal(preview, {
      enabled: true,
      journalPath: 'C:\\temp\\adaptive-preview.json',
      retentionLimit: 12,
      appendRecords: async (filePath, _records, options) => {
        pathArg = filePath;
        retentionArg = options?.retentionLimit;
        return [];
      },
    });

    assert.equal(pathArg, 'C:\\temp\\adaptive-preview.json');
    assert.equal(retentionArg, 12);
  });

  it('surfaces malformed journal JSON errors clearly in preview integration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'jackhammer-adaptive-preview-malformed-'));
    const journalPath = path.join(directory, 'journal.json');
    await writeFile(journalPath, '{ broken json', 'utf8');

    const capture = await captureAdaptivePreviewCommandRunnerFeedback({
      enabled: true,
      requests: [{
        command: process.execPath,
        args: ['-e', 'process.stderr.write("npm run build failed with error TS2322"); process.exit(1);'],
        timeoutMs: 1_000,
        workItemId: 'validate:build',
      }],
    });

    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      executionEvents: capture.executionEvents,
      queueSignals: capture.queueSignals,
    }, { enabled: true });

    await assert.rejects(
      () => captureAdaptivePreviewJournal(preview, {
        enabled: true,
        journalPath,
      }),
      /Malformed event journal .* invalid JSON/,
    );
  });

  it('keeps command-runner conversion behavior intact', async () => {
    const result = await executeCommandCapture({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("npm test failed with assertion error"); process.exit(1)'],
      timeoutMs: 1_000,
      workItemId: 'validate:test',
    });

    const events = commandResultToExecutionEvents(result);
    const signals = commandResultToQueueSignals(result);

    assert.deepEqual(events.map(event => event.kind), ['started', 'stderr', 'exit', 'failed']);
    assert.ok(signals.some(signal => signal.kind === 'test_failure'));
  });
});

function buildCommandExecutionResult(
  override: Partial<CommandExecutionResult> & Pick<CommandExecutionResult, 'command' | 'executable' | 'args'>,
): CommandExecutionResult {
  return {
    command: override.command,
    executable: override.executable,
    args: override.args,
    cwd: override.cwd ?? process.cwd(),
    stdout: override.stdout ?? '',
    stderr: override.stderr ?? '',
    exitCode: override.exitCode ?? 0,
    startedAt: override.startedAt ?? '2026-06-20T12:00:00.000Z',
    completedAt: override.completedAt ?? '2026-06-20T12:00:01.000Z',
    durationMs: override.durationMs ?? 1_000,
    timedOut: override.timedOut ?? false,
    timeoutMs: override.timeoutMs ?? 1_000,
    workItemId: override.workItemId,
  };
}
