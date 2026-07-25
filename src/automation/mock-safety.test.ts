import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { createMockCodexPort } from './mock-codex.js';
import { createMockCopilotPort } from './mock-copilot.js';
import { createMockPlanner } from './mock-planner.js';
import type { WorkPacket } from './work-packet.js';

describe('automation mock safety', () => {
  it('uses deterministic mock ports and does not include external network clients', async () => {
    const packet = buildPacket();
    const planner = createMockPlanner([packet]);
    const codex = createMockCodexPort();
    const copilot = createMockCopilotPort();

    const planned = await planner.planNextWorkPackets({
      runId: 'run',
      repository: packet.repository,
      baseBranch: packet.baseBranch,
      expectedBaseSha: packet.expectedBaseSha,
      objective: packet.objective,
      limit: 1,
      existingWorkItemIds: [],
    });
    assert.deepEqual(planned[0]?.workItemId, packet.workItemId);

    const codexFirst = codex.execute({ packet });
    const codexSecond = codex.execute({ packet });
    const copilotFirst = copilot.execute({ packet });
    const copilotSecond = copilot.execute({ packet });

    assert.deepEqual(codexFirst, codexSecond);
    assert.deepEqual(copilotFirst, copilotSecond);

    const sourceFiles = [
      'src/automation/mock-planner.ts',
      'src/automation/mock-codex.ts',
      'src/automation/mock-copilot.ts',
      'src/automation/orchestrator.ts',
    ];

    for (const filePath of sourceFiles) {
      const text = await readFile(filePath, 'utf8');
      assert.equal(/@octokit|new OpenAI|fetch\s*\(|https?:\/\/|github\.com/i.test(text), false, `Unexpected network client or remote call in ${filePath}`);
    }
  });
});

function buildPacket(): WorkPacket {
  return {
    workItemId: 'packet-0',
    runId: 'run',
    lane: 'codex',
    taskType: 'implementation',
    repository: 'RocketDelivery2/github-copilot-jackhammer-service',
    baseBranch: 'main',
    expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
    authorityCategory: 'analysis',
    objective: 'Deterministic mock packet',
    allowedPaths: ['src/automation'],
    forbiddenPaths: ['.github/workflows'],
    prohibitedActions: ['merge', 'delete-branch'],
    dependencies: [],
    acceptanceCriteria: ['No external side effects'],
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
