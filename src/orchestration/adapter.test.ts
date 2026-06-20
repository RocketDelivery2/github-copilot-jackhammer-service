import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  captureAdaptivePreviewJournal,
  createAdaptiveQueuePreview,
  mapRuntimeInputsToExecutionEvents,
  mapRuntimeInputsToQueueSignals,
  mapRuntimeInputsToWorkItems,
} from './adapter.js';
import type { AdaptiveQueueRuntimeInputs } from './adapter.js';
import {
  commandResultToExecutionEvents,
  commandResultToQueueSignals,
} from './command-runner.js';
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
    const executionEvents = commandResultToExecutionEvents({
      command: 'npm.cmd run build',
      executable: 'npm.cmd',
      args: ['run', 'build'],
      cwd: process.cwd(),
      stdout: '',
      stderr: 'TS2322: Type mismatch',
      exitCode: 1,
      startedAt: '2026-06-20T12:11:00.000Z',
      completedAt: '2026-06-20T12:11:01.000Z',
      durationMs: 1000,
      timedOut: false,
      timeoutMs: 60_000,
      workItemId: 'validate:build',
    });
    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      executionEvents,
      queueSignals: [],
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
    const queueSignals = commandResultToQueueSignals({
      command: 'npm.cmd test',
      executable: 'npm.cmd',
      args: ['test'],
      cwd: process.cwd(),
      stdout: '',
      stderr: 'npm test failed with assertion error',
      exitCode: 1,
      startedAt: '2026-06-20T12:13:00.000Z',
      completedAt: '2026-06-20T12:13:01.000Z',
      durationMs: 1000,
      timedOut: false,
      timeoutMs: 60_000,
      workItemId: 'validate:test',
    });
    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      executionEvents: [],
      queueSignals,
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

  it('uses configured journal path and retention', async () => {
    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      executionEvents: mapRuntimeInputsToExecutionEvents({
        executionEvents: [{
          workItemId: 'validate:lint',
          kind: 'failed',
          message: 'Command exited with code 1.',
          exitCode: 1,
        }],
      }),
      queueSignals: [{
        kind: 'lint_failure',
        severity: 'error',
        message: 'ESLint failure detected.',
        workItemId: 'validate:lint',
      }],
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

    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      executionEvents: [{
        workItemId: 'validate:build',
        kind: 'failed',
        message: 'Command exited with code 1.',
        exitCode: 1,
      }],
      queueSignals: [],
    }, { enabled: true });

    await assert.rejects(
      () => captureAdaptivePreviewJournal(preview, {
        enabled: true,
        journalPath,
      }),
      /Malformed event journal .* invalid JSON/,
    );
  });
});
