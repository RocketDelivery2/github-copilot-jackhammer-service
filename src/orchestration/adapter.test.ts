import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAdaptiveQueuePreview,
  mapRuntimeInputsToQueueSignals,
  mapRuntimeInputsToWorkItems,
} from './adapter.js';
import type { AdaptiveQueueRuntimeInputs } from './adapter.js';

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
});
