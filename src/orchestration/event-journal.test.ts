import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createAdaptiveQueuePreview } from './adapter.js';
import {
  appendEventJournalRecords,
  applyEventJournalRetention,
  createExecutionEventJournalRecord,
  createQueueSignalJournalRecord,
  loadEventJournal,
} from './event-journal.js';

const firstCreatedAt = '2026-06-20T12:00:00.000Z';
const secondCreatedAt = '2026-06-20T12:01:00.000Z';
const thirdCreatedAt = '2026-06-20T12:02:00.000Z';

describe('event journal', () => {
  it('loads an empty journal when the file is missing', async () => {
    const journalPath = await createJournalPath('missing');

    const records = await loadEventJournal(journalPath);

    assert.deepEqual(records, []);
  });

  it('appends execution events and queue signals', async () => {
    const journalPath = await createJournalPath('append-mixed');
    const executionEvent = createExecutionEventJournalRecord({
      createdAt: firstCreatedAt,
      source: 'command-runner',
      event: {
        workItemId: 'validate:test',
        kind: 'stderr',
        stderr: 'npm test failed with assertion error',
      },
    });
    const queueSignal = createQueueSignalJournalRecord({
      createdAt: secondCreatedAt,
      source: 'signals',
      signal: {
        kind: 'test_failure',
        severity: 'error',
        message: 'Test failure detected.',
        workItemId: 'validate:test',
        evidence: 'npm test failed with assertion error',
      },
    });

    const saved = await appendEventJournalRecords(journalPath, [executionEvent, queueSignal]);
    const loaded = await loadEventJournal(journalPath);

    assert.deepEqual(saved, [executionEvent, queueSignal]);
    assert.deepEqual(loaded, [executionEvent, queueSignal]);
  });

  it('preserves existing journal entries when appending', async () => {
    const journalPath = await createJournalPath('preserve-existing');
    const firstRecord = createExecutionEventJournalRecord({
      createdAt: firstCreatedAt,
      source: 'command-runner',
      event: {
        workItemId: 'validate:build',
        kind: 'started',
        message: 'Started command: npm.cmd run build',
      },
    });
    const secondRecord = createQueueSignalJournalRecord({
      createdAt: secondCreatedAt,
      source: 'signals',
      signal: {
        kind: 'build_failure',
        severity: 'error',
        message: 'Build failure detected.',
        workItemId: 'validate:build',
      },
    });

    await appendEventJournalRecords(journalPath, [firstRecord]);
    await appendEventJournalRecords(journalPath, [secondRecord]);

    assert.deepEqual(await loadEventJournal(journalPath), [firstRecord, secondRecord]);
  });

  it('applies retention limits deterministically', async () => {
    const journalPath = await createJournalPath('retention');
    const firstRecord = journalRecord('one', firstCreatedAt);
    const secondRecord = journalRecord('two', secondCreatedAt);
    const thirdRecord = journalRecord('three', thirdCreatedAt);

    const retained = await appendEventJournalRecords(
      journalPath,
      [firstRecord, secondRecord, thirdRecord],
      { retentionLimit: 2 },
    );

    assert.deepEqual(retained, [secondRecord, thirdRecord]);
    assert.deepEqual(await loadEventJournal(journalPath), [secondRecord, thirdRecord]);
    assert.deepEqual(applyEventJournalRetention([firstRecord, secondRecord, thirdRecord], 2), [
      secondRecord,
      thirdRecord,
    ]);
  });

  it('rejects malformed journal JSON', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'jackhammer-event-journal-malformed-'));
    const journalPath = path.join(directory, 'journal.json');
    await writeFile(journalPath, '{ not json', 'utf8');

    await assert.rejects(
      () => loadEventJournal(journalPath),
      /Malformed event journal .* invalid JSON/,
    );
  });

  it('does not change default runtime scheduling behavior', () => {
    const preview = createAdaptiveQueuePreview({
      activeWorkItem: undefined,
      commandQueue: [],
      guidance: null,
      recentResults: [],
    }, { enabled: false });

    assert.equal(preview.mode, 'legacy');
    assert.equal(preview.schedulerInvoked, false);
    assert.deepEqual(preview.scheduledWorkItemIds, []);
  });
});

async function createJournalPath(name: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), `jackhammer-event-journal-${name}-`));
  return path.join(directory, 'nested', 'journal.json');
}

function journalRecord(workItemId: string, createdAt: string) {
  return createExecutionEventJournalRecord({
    createdAt,
    source: 'command-runner',
    event: {
      workItemId,
      kind: 'completed',
      message: 'Command completed successfully.',
    },
  });
}
