import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceAutomationRun,
  DEFAULT_AUTOMATION_POLICY,
  initializeAutomationRun,
  refillQueues,
} from './orchestrator.js';
import { createAutomationRunState } from './automation-run.js';
import { createMockPlanner } from './mock-planner.js';
import { createMockCodexPort } from './mock-codex.js';
import { createMockCopilotPort } from './mock-copilot.js';
import { createRawOutputArtifact, normalizeEvidence, promoteEvidenceClassification } from './evidence-normalizer.js';
import { enterManualGate, resumeManualGate } from './manual-gate.js';
import { createInMemoryStateStore } from './in-memory-state-store.js';
import { markPacketCompleted, markPacketDispatched, readyQueueDepth } from './queue-controller.js';
import type { WorkPacket } from './work-packet.js';

const FIXED_NOW = () => '2026-07-25T00:00:00.000Z';

describe('automation control loop scaffold', () => {
  it('plans 100 packets while keeping the codex ready queue capped at 10', async () => {
    const planner = createMockPlanner(buildPackets(100, 'codex'));
    const state = await initializeAutomationRun(
      {
        runId: 'run-100',
        repository: 'RocketDelivery2/github-copilot-jackhammer-service',
        baseBranch: 'main',
        expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
        objective: 'Seed 100 packets',
        now: FIXED_NOW,
      },
      { planner },
    );

    assert.equal(Object.keys(state.packets).length, 100);
    assert.equal(state.plannedOrder.length, 100);
    assert.equal(readyQueueDepth(state, 'codex'), 10);
    assert.equal(state.readyQueue.length, 10);
    assert.equal(state.status, 'READY');
  });

  it('refills the codex queue when it drops below the low watermark', async () => {
    const planner = createMockPlanner(buildPackets(100, 'codex'));
    const state = await initializeAutomationRun(
      {
        runId: 'run-refill',
        repository: 'RocketDelivery2/github-copilot-jackhammer-service',
        baseBranch: 'main',
        expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
        objective: 'Refill queue',
        now: FIXED_NOW,
      },
      { planner },
    );

    let next = state;
    for (const workItemId of next.readyQueue.slice(0, 5)) {
      next = markPacketDispatched(next, workItemId, FIXED_NOW);
    }

    assert.equal(readyQueueDepth(next, 'codex'), 5);
    next = refillQueues(next, DEFAULT_AUTOMATION_POLICY, FIXED_NOW);
    assert.equal(readyQueueDepth(next, 'codex'), 10);
  });

  it('enforces Copilot concurrency of exactly 1', async () => {
    const planner = createMockPlanner(buildPackets(2, 'copilot'));
    const state = await initializeAutomationRun(
      {
        runId: 'run-copilot',
        repository: 'RocketDelivery2/github-copilot-jackhammer-service',
        baseBranch: 'main',
        expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
        objective: 'Single copilot lane',
        now: FIXED_NOW,
      },
      { planner },
      {
        ...DEFAULT_AUTOMATION_POLICY,
        codex: { ...DEFAULT_AUTOMATION_POLICY.codex, maxConcurrent: 1 },
        copilot: { ...DEFAULT_AUTOMATION_POLICY.copilot, maxConcurrent: 1 },
      },
    );

    const ports = { planner, codex: createMockCodexPort(), copilot: createMockCopilotPort() };
    const first = await advanceAutomationRun(state, ports, {
      ...DEFAULT_AUTOMATION_POLICY,
      codex: { ...DEFAULT_AUTOMATION_POLICY.codex, maxConcurrent: 1 },
      copilot: { ...DEFAULT_AUTOMATION_POLICY.copilot, maxConcurrent: 1 },
    }, FIXED_NOW);
    assert.equal(first.completedWorkItemIds.length, 1);
    assert.equal(first.packets['copilot-000'].status, 'COMPLETED');
    assert.equal(first.packets['copilot-001'].status, 'PLANNED');

    const second = await advanceAutomationRun(first, ports, {
      ...DEFAULT_AUTOMATION_POLICY,
      codex: { ...DEFAULT_AUTOMATION_POLICY.codex, maxConcurrent: 1 },
      copilot: { ...DEFAULT_AUTOMATION_POLICY.copilot, maxConcurrent: 1 },
    }, FIXED_NOW);
    assert.equal(second.completedWorkItemIds.length, 2);
    assert.equal(second.packets['copilot-001'].status, 'COMPLETED');
  });

  it('blocks dependent packets until their prerequisite is completed', async () => {
    const planner = createMockPlanner([
      buildPacket('root', 'codex', { priority: 'high' }),
      buildPacket('dependent', 'codex', { dependencies: ['root'] }),
    ]);
    const state = await initializeAutomationRun(
      {
        runId: 'run-deps',
        repository: 'RocketDelivery2/github-copilot-jackhammer-service',
        baseBranch: 'main',
        expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
        objective: 'Dependency sequencing',
        now: FIXED_NOW,
      },
      { planner },
    );

    assert.equal(state.readyQueue.includes('root'), true);
    assert.equal(state.readyQueue.includes('dependent'), false);

    const ports = { planner, codex: createMockCodexPort(), copilot: createMockCopilotPort() };
    const afterRoot = await advanceAutomationRun(state, ports, DEFAULT_AUTOMATION_POLICY, FIXED_NOW);
    assert.equal(afterRoot.completedWorkItemIds.includes('root'), true);
    assert.equal(afterRoot.completedWorkItemIds.includes('dependent'), false);

    const afterDependent = await advanceAutomationRun(afterRoot, ports, DEFAULT_AUTOMATION_POLICY, FIXED_NOW);
    assert.equal(afterDependent.completedWorkItemIds.includes('dependent'), true);
  });

  it('rejects duplicate work-item completion without duplicate effects', () => {
    const state = createAutomationRunState({
      runId: 'run-duplicate',
      repository: 'RocketDelivery2/github-copilot-jackhammer-service',
      baseBranch: 'main',
      expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
      objective: 'Duplicate completion',
      plannedPackets: [buildPacket('dup', 'codex')],
      now: FIXED_NOW,
    });

    const artifact = createRawOutputArtifact('run-duplicate', 'dup', 'raw-output', FIXED_NOW);
    const evidence = normalizeEvidence({
      workItemId: 'dup',
      runId: 'run-duplicate',
      lane: 'codex',
      rawOutput: 'raw-output',
      rawOutputArtifactId: artifact.artifactId,
      summary: 'summary',
      details: ['one'],
      createdAt: FIXED_NOW(),
    }, FIXED_NOW);

    const first = markPacketCompleted(state, 'dup', artifact.artifactId, evidence.evidenceId, 'summary', FIXED_NOW);
    const second = markPacketCompleted(first, 'dup', artifact.artifactId, evidence.evidenceId, 'summary', FIXED_NOW);

    assert.equal(first.completedWorkItemIds.length, 1);
    assert.equal(first.packets.dup.status, 'COMPLETED');
    assert.equal(second.completedWorkItemIds.length, 1);
    assert.equal(second.packets.dup.status, 'COMPLETED');
  });

  it('pauses on a manual gate and resumes only after explicit approval', async () => {
    const planner = createMockPlanner(buildPackets(1, 'codex'));
    const state = await initializeAutomationRun(
      {
        runId: 'run-gate',
        repository: 'RocketDelivery2/github-copilot-jackhammer-service',
        baseBranch: 'main',
        expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
        objective: 'Manual gate',
        now: FIXED_NOW,
      },
      { planner },
    );

    const gated = enterManualGate(state, 'Owner approval required', 'Confirm the packet set', FIXED_NOW).state;
    assert.equal(gated.status, 'MANUAL_REQUIRED');
    assert.equal(gated.manualGate?.reason, 'Owner approval required');

    const ports = { planner, codex: createMockCodexPort(), copilot: createMockCopilotPort() };
    const pausedAdvance = await advanceAutomationRun(gated, ports, DEFAULT_AUTOMATION_POLICY, FIXED_NOW);
    assert.equal(pausedAdvance.completedWorkItemIds.length, 0);
    assert.equal(pausedAdvance.readyQueue.length, gated.readyQueue.length);

    const resumed = resumeManualGate(pausedAdvance, 'Christopher', FIXED_NOW).state;
    assert.equal(resumed.status, 'READY');
    assert.equal(resumed.manualGate?.approvedBy, 'Christopher');

    const completed = await advanceAutomationRun(resumed, ports, DEFAULT_AUTOMATION_POLICY, FIXED_NOW);
    assert.equal(completed.completedWorkItemIds.length, 1);
    assert.equal(completed.status, 'COMPLETED');
  });

  it('stops when the run budget is exhausted', async () => {
    const planner = createMockPlanner(buildPackets(2, 'codex', { maximumCostUsd: 1 }));
    const state = await initializeAutomationRun(
      {
        runId: 'run-budget',
        repository: 'RocketDelivery2/github-copilot-jackhammer-service',
        baseBranch: 'main',
        expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
        objective: 'Budget exhaustion',
        maximumCostUsd: 1,
        now: FIXED_NOW,
      },
      { planner },
      {
        ...DEFAULT_AUTOMATION_POLICY,
        codex: { ...DEFAULT_AUTOMATION_POLICY.codex, maxConcurrent: 1 },
        copilot: { ...DEFAULT_AUTOMATION_POLICY.copilot, maxConcurrent: 1 },
      },
    );

    const ports = { planner, codex: createMockCodexPort(), copilot: createMockCopilotPort() };
    const first = await advanceAutomationRun(state, ports, {
      ...DEFAULT_AUTOMATION_POLICY,
      codex: { ...DEFAULT_AUTOMATION_POLICY.codex, maxConcurrent: 1 },
      copilot: { ...DEFAULT_AUTOMATION_POLICY.copilot, maxConcurrent: 1 },
    }, FIXED_NOW);
    assert.equal(first.completedWorkItemIds.length, 1);
    assert.equal(first.budget.exhausted, true);
    assert.equal(first.status, 'BLOCKED');

    const second = await advanceAutomationRun(first, ports, {
      ...DEFAULT_AUTOMATION_POLICY,
      codex: { ...DEFAULT_AUTOMATION_POLICY.codex, maxConcurrent: 1 },
      copilot: { ...DEFAULT_AUTOMATION_POLICY.copilot, maxConcurrent: 1 },
    }, FIXED_NOW);
    assert.equal(second.completedWorkItemIds.length, 1);
    assert.equal(second.packets['codex-001'].status, 'READY');
  });

  it('preserves deterministic ordering among equally prioritized ready jobs', async () => {
    const packets = [
      buildPacket('b', 'codex', { priority: 'medium' }),
      buildPacket('a', 'codex', { priority: 'high' }),
      buildPacket('c', 'codex', { priority: 'medium' }),
    ];
    const planner = createMockPlanner(packets);
    const state1 = await initializeAutomationRun(
      {
        runId: 'run-order-1',
        repository: 'RocketDelivery2/github-copilot-jackhammer-service',
        baseBranch: 'main',
        expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
        objective: 'Deterministic order',
        now: FIXED_NOW,
      },
      { planner },
    );
    const state2 = await initializeAutomationRun(
      {
        runId: 'run-order-2',
        repository: 'RocketDelivery2/github-copilot-jackhammer-service',
        baseBranch: 'main',
        expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
        objective: 'Deterministic order',
        now: FIXED_NOW,
      },
      { planner: createMockPlanner(packets) },
    );

    assert.deepEqual(state1.readyQueue, ['a', 'b', 'c']);
    assert.deepEqual(state2.readyQueue, ['a', 'b', 'c']);
  });

  it('supports restoring state from the local state store', async () => {
    const store = createInMemoryStateStore();
    const planner = createMockPlanner(buildPackets(1, 'codex'));
    const state = await initializeAutomationRun(
      {
        runId: 'run-store',
        repository: 'RocketDelivery2/github-copilot-jackhammer-service',
        baseBranch: 'main',
        expectedBaseSha: 'affc203b8213c5364374fcdda217ade034bb150e',
        objective: 'State persistence',
        now: FIXED_NOW,
      },
      { planner },
    );

    await store.save(state);
    const restored = await store.load();

    assert.ok(restored);
    assert.equal(restored?.runId, state.runId);
    assert.equal(restored?.readyQueue.length, state.readyQueue.length);
    assert.deepEqual(restored?.completedWorkItemIds, state.completedWorkItemIds);
  });

  it('evidence normalization is deterministic and cannot be silently promoted', () => {
    const rawArtifact = createRawOutputArtifact('run-evidence', 'packet', 'raw text', FIXED_NOW);
    const evidence = normalizeEvidence({
      workItemId: 'packet',
      runId: 'run-evidence',
      lane: 'codex',
      rawOutput: 'raw text',
      rawOutputArtifactId: rawArtifact.artifactId,
      summary: 'normalized summary',
      details: ['detail'],
      createdAt: FIXED_NOW(),
    }, FIXED_NOW);

    const promoted = promoteEvidenceClassification(evidence, {
      targetClassification: 'verified',
      approvedBy: 'Christopher',
      reason: 'manual review',
    });

    assert.equal(evidence.classification, 'normalized');
    assert.equal(promoted.classification, 'verified');
    assert.throws(
      () => promoteEvidenceClassification(evidence, {
        targetClassification: 'verified',
        approvedBy: '',
        reason: 'missing owner approval',
      }),
      /requires an approving owner/,
    );
  });
});

function buildPackets(count: number, lane: WorkPacket['lane'], overrides: Partial<WorkPacket> = {}): WorkPacket[] {
  return Array.from({ length: count }, (_, index) => buildPacket(`${lane}-${String(index).padStart(3, '0')}`, lane, overrides));
}

function buildPacket(workItemId: string, lane: WorkPacket['lane'], overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    workItemId,
    runId: overrides.runId ?? 'run-default',
    lane,
    taskType: overrides.taskType ?? 'implementation',
    repository: overrides.repository ?? 'RocketDelivery2/github-copilot-jackhammer-service',
    baseBranch: overrides.baseBranch ?? 'main',
    expectedBaseSha: overrides.expectedBaseSha ?? 'affc203b8213c5364374fcdda217ade034bb150e',
    authorityCategory: overrides.authorityCategory ?? 'analysis',
    objective: overrides.objective ?? `Objective for ${workItemId}`,
    allowedPaths: overrides.allowedPaths ?? [`src/${workItemId}.ts`],
    forbiddenPaths: overrides.forbiddenPaths ?? ['.github/workflows'],
    prohibitedActions: overrides.prohibitedActions ?? ['merge', 'delete-branch'],
    dependencies: overrides.dependencies ?? [],
    acceptanceCriteria: overrides.acceptanceCriteria ?? [`${workItemId} completes deterministically`],
    requiredCommands: overrides.requiredCommands ?? ['npm test'],
    maximumFilesChanged: overrides.maximumFilesChanged ?? 3,
    maximumLinesChanged: overrides.maximumLinesChanged ?? 120,
    maximumCostUsd: overrides.maximumCostUsd ?? 5,
    maximumDurationMinutes: overrides.maximumDurationMinutes ?? 15,
    manualGateTriggers: overrides.manualGateTriggers ?? ['owner-review'],
    outputSchemaVersion: overrides.outputSchemaVersion ?? 1,
    priority: overrides.priority ?? 'medium',
  };
}
