import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadState, normalizeState } from '../state.js';

describe('state', () => {
  it('returns default state when the file does not exist', async () => {
    const state = await loadState(path.join(tmpdir(), `jackhammer-missing-${Date.now()}.json`));

    assert.deepEqual(state, {
      createdIssueHashes: {},
      commandQueue: [],
      recentCopilotResults: [],
    });
  });

  it('rejects malformed state JSON instead of silently resetting', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'jackhammer-state-malformed-'));
    const statePath = path.join(directory, 'state.json');
    await writeFile(statePath, '{ not json', 'utf8');

    await assert.rejects(
      () => loadState(statePath),
      /contains invalid JSON/,
    );
  });

  it('normalizes partial state and drops invalid entries', () => {
    const state = normalizeState({
      createdIssueHashes: {
        valid: {
          issueNumber: 42,
          url: 'https://example.test/issues/42',
          title: 'Valid',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        invalid: {
          issueNumber: 'not-a-number',
        },
      },
      commandQueue: [
        {
          hash: 'abc123',
          title: 'Fix lint issue',
          priority: 'high',
          prompt: 'Run lint and fix errors',
        },
        {
          hash: 123,
        },
      ],
      recentCopilotResults: [
        {
          issueNumber: 7,
          title: 'Fix bug',
          outcome: 'merged',
          summary: 'Done',
          recordedAt: '2026-07-01T00:00:00.000Z',
        },
        {
          issueNumber: 8,
          outcome: 'bad-value',
        },
      ],
    });

    assert.deepEqual(Object.keys(state.createdIssueHashes), ['valid']);
    assert.equal(state.commandQueue.length, 1);
    assert.equal(state.commandQueue[0]?.hash, 'abc123');
    assert.equal(state.recentCopilotResults.length, 1);
    assert.equal(state.recentCopilotResults[0]?.issueNumber, 7);
  });
});
