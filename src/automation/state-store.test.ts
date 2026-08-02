import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createMockPlanner } from './mock-planner.js';
import { initializeAutomationRun } from './orchestrator.js';
import { loadAutomationState, saveAutomationState } from './in-memory-state-store.js';
import type { WorkPacket } from './work-packet.js';

const FIXED_NOW = () => '2026-07-25T00:00:00.000Z';

describe('automation state store', () => {
  it('persists and restores the run state from disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jackhammer-automation-state-'));
    try {
      const filePath = path.join(dir, 'run.json');
      const planner = createMockPlanner([buildPacket('packet-0', 'codex')]);
      const state = await initializeAutomationRun(
        {
          runId: 'run-state-store',
          repository: 'RocketDelivery2/github-copilot-jackhammer-service',
          baseBranch: 'main',
          expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
          objective: 'Persist run state',
          now: FIXED_NOW,
        },
        { planner },
      );

      await saveAutomationState(filePath, state);
      const restored = await loadAutomationState(filePath);

      assert.ok(restored);
      assert.equal(restored?.runId, state.runId);
      assert.equal(restored?.status, state.status);
      assert.equal(restored?.readyQueue.length, state.readyQueue.length);
      assert.deepEqual(restored?.plannedOrder, state.plannedOrder);
      assert.equal(restored?.events.length, state.events.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function buildPacket(workItemId: string, lane: WorkPacket['lane']): WorkPacket {
  return {
    workItemId,
    runId: 'run-state-store',
    lane,
    taskType: 'implementation',
    repository: 'RocketDelivery2/github-copilot-jackhammer-service',
    baseBranch: 'main',
    expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
    authorityCategory: 'analysis',
    objective: `Objective for ${workItemId}`,
    allowedPaths: ['src/automation'],
    forbiddenPaths: ['.github/workflows'],
    prohibitedActions: ['merge', 'delete-branch'],
    dependencies: [],
    acceptanceCriteria: ['Deterministic state persistence'],
    requiredCommands: ['npm test'],
    maximumFilesChanged: 1,
    maximumLinesChanged: 20,
    maximumCostUsd: 1,
    maximumDurationMinutes: 5,
    manualGateTriggers: ['owner-review'],
    outputSchemaVersion: 1,
    priority: 'medium',
  };
}
