import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  buildAdaptivePreviewSkillExecutionPlans,
  buildAdaptivePreviewCommandCaptureRequests,
  captureAdaptivePreviewCommandRunnerFeedback,
  captureAdaptivePreviewJournal,
  createAdaptiveQueuePreview,
  mapRuntimeInputsToQueueSignals,
  selectAdaptivePreviewSkills,
  mapRuntimeInputsToWorkItems,
} from './adapter.js';
import type {
  AdaptivePreviewSkillTask,
  AdaptivePreviewValidationProbe,
  AdaptiveQueueRuntimeInputs,
} from './adapter.js';
import {
  commandResultToExecutionEvents,
  commandResultToQueueSignals,
  executeCommandCapture,
} from './command-runner.js';
import type { CommandExecutionResult } from './command-runner.js';
import type { EventJournalRecord } from './event-journal.js';
import { createSkillMetadataIndex } from '../skills/registry.js';
import type { SkillDocument } from '../skills/types.js';

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

  it('disabled preview yields no capture requests regardless of source', () => {
    const recent = buildAdaptivePreviewCommandCaptureRequests({
      enabled: false,
      source: 'recent-results',
      limit: 3,
      recentResults: runtimeInputs.recentResults,
    });
    const probes = buildAdaptivePreviewCommandCaptureRequests({
      enabled: false,
      source: 'validation-probes',
      limit: 3,
      validationProbes: [{ command: 'npm.cmd', args: ['test'] }],
    });

    assert.deepEqual(recent, []);
    assert.deepEqual(probes, []);
  });

  it('source none yields no requests and no capture', async () => {
    const requests = buildAdaptivePreviewCommandCaptureRequests({
      enabled: true,
      source: 'none',
      limit: 3,
      recentResults: runtimeInputs.recentResults,
    });

    let captureInvoked = false;
    const capture = await captureAdaptivePreviewCommandRunnerFeedback({
      enabled: true,
      requests,
      executeCapture: async () => {
        captureInvoked = true;
        return buildCommandExecutionResult({
          command: 'noop',
          executable: process.execPath,
          args: ['-e', 'process.stdout.write("noop")'],
        });
      },
    });

    assert.deepEqual(requests, []);
    assert.equal(captureInvoked, false);
    assert.deepEqual(capture.commandResults, []);
    assert.deepEqual(capture.executionEvents, []);
    assert.deepEqual(capture.queueSignals, []);
  });

  it('source recent-results preserves preview capture behavior', async () => {
    const requests = buildAdaptivePreviewCommandCaptureRequests({
      enabled: true,
      source: 'recent-results',
      limit: 3,
      recentResults: runtimeInputs.recentResults,
      nodeExecutable: process.execPath,
      defaultCwd: process.cwd(),
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.command, process.execPath);
    assert.equal(requests[0]?.workItemId, 'issue:44');

    const capture = await captureAdaptivePreviewCommandRunnerFeedback({
      enabled: true,
      requests,
    });

    assert.equal(capture.commandResults.length, 1);
    assert.ok(capture.executionEvents.length > 0);
    assert.ok(capture.queueSignals.some(signal => signal.kind === 'test_failure'));
  });

  it('source validation-probes runs only configured capped probes', () => {
    const probes: AdaptivePreviewValidationProbe[] = [
      { command: 'npm.cmd', args: ['run', 'build'], workItemId: 'validate:build' },
      { command: 'npm.cmd', args: ['test'], workItemId: 'validate:test' },
    ];

    const requests = buildAdaptivePreviewCommandCaptureRequests({
      enabled: true,
      source: 'validation-probes',
      limit: 1,
      validationProbes: probes,
      defaultCwd: 'C:\\repo',
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.command, 'npm.cmd');
    assert.deepEqual(requests[0]?.args, ['run', 'build']);
    assert.equal(requests[0]?.workItemId, 'validate:build');
    assert.equal(requests[0]?.cwd, 'C:\\repo');
  });

  it('enforces capture limit deterministically', async () => {
    const requests = [
      { command: process.execPath, args: ['-e', 'process.stdout.write("one")'], workItemId: 'w1' },
      { command: process.execPath, args: ['-e', 'process.stdout.write("two")'], workItemId: 'w2' },
      { command: process.execPath, args: ['-e', 'process.stdout.write("three")'], workItemId: 'w3' },
    ];

    const executed: string[] = [];
    const capture = await captureAdaptivePreviewCommandRunnerFeedback({
      enabled: true,
      requests,
      captureLimit: 2,
      executeCapture: async request => {
        executed.push(request.workItemId ?? 'unknown');
        return buildCommandExecutionResult({
          command: request.command,
          executable: request.command,
          args: [...(request.args ?? [])],
          stdout: request.workItemId ?? 'unknown',
          workItemId: request.workItemId,
        });
      },
    });

    assert.deepEqual(executed, ['w1', 'w2']);
    assert.equal(capture.commandResults.length, 2);
  });

  it('does not select preview skills while adaptive preview is disabled', () => {
    const skillIndex = createSkillMetadataIndex([
      {
        skillPath: 'skills/validation/skill.md',
        markdown: `---
name: validation
description: Validate code changes with test build lint workflow.
version: 1.0.0
risk: low
allowedTools: [npm.cmd]
resourceHints: [package.json]
keywords: [validation, test, build, lint]
---
`,
      },
    ]);

    const selected = selectAdaptivePreviewSkills({
      enabled: false,
      skillIndex,
      tasks: [{ id: 't1', title: 'run test build lint' }],
    });

    assert.deepEqual(selected, []);
  });

  it('selects preview skills deterministically for representative tasks', () => {
    const skillIndex = createSkillMetadataIndex([
      {
        skillPath: 'skills/repo-inspection/skill.md',
        markdown: `---
name: repo-inspection
description: Inspect repository state safely with bounded targeted reads.
version: 1.0.0
risk: low
allowedTools: [git, rg, glob, view]
resourceHints: [src/]
keywords: [inspect, repository, diff]
---
`,
      },
      {
        skillPath: 'skills/typescript-patch/skill.md',
        markdown: `---
name: typescript-patch
description: Apply a small reviewable TypeScript change with bounded inspection.
version: 1.0.0
risk: medium
allowedTools: [apply_patch, npm.cmd]
resourceHints: [src/**/*.ts]
keywords: [typescript, patch]
---
`,
      },
      {
        skillPath: 'skills/validation/skill.md',
        markdown: `---
name: validation
description: Validate code changes with test build lint and summarize outcomes.
version: 1.0.0
risk: low
allowedTools: [npm.cmd]
resourceHints: [package.json]
keywords: [validation, test, build, lint]
---
`,
      },
      {
        skillPath: 'skills/error-recovery/skill.md',
        markdown: `---
name: error-recovery
description: Recover from command failures by classifying errors and emitting one repair command.
version: 1.0.0
risk: medium
allowedTools: [powershell]
resourceHints: [logs]
keywords: [error, failure, repair]
---
`,
      },
    ]);

    const tasks: AdaptivePreviewSkillTask[] = [
      { id: 'validate:build', title: 'run validation test build lint' },
      { id: 'inspect:repo', title: 'inspect repository diff' },
      { id: 'patch:ts', title: 'apply typescript patch to adapter' },
      { id: 'failure:cmd', title: 'command failure requires repair' },
    ];

    const selected = selectAdaptivePreviewSkills({
      enabled: true,
      skillIndex,
      tasks,
      maxSelections: 10,
      maxMatchesPerTask: 1,
    });

    assert.ok(selected.some(entry => entry.taskId === 'validate:build' && entry.skillName === 'validation'));
    assert.ok(selected.some(entry => entry.taskId === 'inspect:repo' && entry.skillName === 'repo-inspection'));
    assert.ok(selected.some(entry => entry.taskId === 'patch:ts' && entry.skillName === 'typescript-patch'));
    assert.ok(selected.some(entry => entry.taskId === 'failure:cmd' && entry.skillName === 'error-recovery'));

    const rankings = selected.map(entry => entry.rank);
    assert.deepEqual(rankings, rankings.slice().sort((left, right) => left - right));
  });

  it('produces deterministic skill-selection journal payload ordering', () => {
    const skillIndex = createSkillMetadataIndex([
      {
        skillPath: 'skills/validation/skill.md',
        markdown: `---
name: validation
description: Validate code changes with test build lint and summarize outcomes.
version: 1.0.0
risk: low
allowedTools: [npm.cmd]
resourceHints: [package.json]
keywords: [validation, test, build, lint]
---
`,
      },
    ]);

    const tasks: AdaptivePreviewSkillTask[] = [
      { id: 'a', title: 'run validation test build lint' },
      { id: 'b', title: 'validation build test lint checks' },
    ];

    const first = selectAdaptivePreviewSkills({
      enabled: true,
      skillIndex,
      tasks,
      maxSelections: 4,
      maxMatchesPerTask: 1,
    });
    const second = selectAdaptivePreviewSkills({
      enabled: true,
      skillIndex,
      tasks,
      maxSelections: 4,
      maxMatchesPerTask: 1,
    });

    assert.deepEqual(first, second);
  });

  it('captures preview skill-selection journal records deterministically', async () => {
    const skillIndex = createSkillMetadataIndex([
      {
        skillPath: 'skills/error-recovery/skill.md',
        markdown: `---
name: error-recovery
description: Recover from command failures by classifying errors and emitting one repair command.
version: 1.0.0
risk: medium
allowedTools: [powershell]
resourceHints: [logs]
keywords: [error, failure, repair]
---
`,
      },
    ]);
    const skillSelections = selectAdaptivePreviewSkills({
      enabled: true,
      skillIndex,
      tasks: [{ id: 'signal:test_failure', title: 'command failure requires repair' }],
      maxSelections: 1,
      maxMatchesPerTask: 1,
    });
    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      skillSelections,
    }, { enabled: true });
    const appended: EventJournalRecord[] = [];

    await captureAdaptivePreviewJournal(preview, {
      enabled: true,
      journalPath: 'ignored.json',
      appendRecords: async (_filePath, records) => {
        appended.push(...records);
        return [...records];
      },
      now: () => '2026-06-20T12:15:00.000Z',
      source: 'adapter-test',
    });

    const skillRecord = appended.find(record => record.type === 'skill_selection');
    assert.ok(skillRecord && skillRecord.type === 'skill_selection');
    if (!skillRecord || skillRecord.type !== 'skill_selection') {
      throw new Error('Expected a skill_selection record to be appended.');
    }
    assert.equal(skillRecord.selection.skillName, 'error-recovery');
    assert.equal(skillRecord.selection.trustPolicySummary.scriptsRequireHumanApproval, true);
    assert.equal(skillRecord.selection.trustPolicySummary.scriptsAutoExecutable, false);
  });

  it('disabled/default path produces no skill execution plans', async () => {
    const skillIndex = createSkillMetadataIndex([{
      skillPath: 'skills/validation/skill.md',
      markdown: `---
name: validation
description: Validate code changes with test build lint workflow.
version: 1.0.0
risk: low
allowedTools: [npm.cmd]
resourceHints: [package.json]
keywords: [validation, test, build, lint]
---
`,
    }]);

    const plans = await buildAdaptivePreviewSkillExecutionPlans({
      enabled: false,
      skillSelections: [],
      skillIndex,
    });

    assert.deepEqual(plans, []);
  });

  it('enabled preview produces deterministic bounded dry-run execution plans from selected skills only', async () => {
    const skillIndex = createSkillMetadataIndex([
      {
        skillPath: 'skills/validation/skill.md',
        markdown: `---
name: validation
description: Validate code changes with test build lint workflow.
version: 1.0.0
risk: low
allowedTools: [npm.cmd]
resourceHints: [package.json]
keywords: [validation, test, build, lint]
---
`,
      },
      {
        skillPath: 'skills/error-recovery/skill.md',
        markdown: `---
name: error-recovery
description: Recover from command failures with one repair step.
version: 1.0.0
risk: medium
allowedTools: [powershell]
resourceHints: [logs]
keywords: [error, failure, repair]
---
`,
      },
    ]);

    const selected = selectAdaptivePreviewSkills({
      enabled: true,
      skillIndex,
      tasks: [
        { id: 'task:validate', title: 'run test build lint validation' },
        { id: 'task:error', title: 'command failure needs repair' },
      ],
      maxSelections: 2,
      maxMatchesPerTask: 1,
    });

    const loadCalls: string[] = [];
    const mockLoad = async (filePath: string): Promise<SkillDocument> => {
      loadCalls.push(filePath);
      return {
        metadata: {
          name: filePath.includes('validation') ? 'validation' : 'error-recovery',
          description: 'mock',
          version: '1.0.0',
          risk: filePath.includes('validation') ? 'low' : 'medium',
          allowedTools: [],
          resourceHints: [],
          keywords: [],
          skillPath: filePath,
        },
        body: [
          '# Mock Skill',
          '## Procedure',
          '1. Step one',
          '2. Step two',
          '3. Step three',
        ].join('\n'),
      };
    };

    const first = await buildAdaptivePreviewSkillExecutionPlans({
      enabled: true,
      skillSelections: selected,
      skillIndex,
      maxPlans: 1,
      maxStepsPerPlan: 2,
      loadSkillDocument: mockLoad,
    });
    const second = await buildAdaptivePreviewSkillExecutionPlans({
      enabled: true,
      skillSelections: selected,
      skillIndex,
      maxPlans: 1,
      maxStepsPerPlan: 2,
      loadSkillDocument: mockLoad,
    });

    assert.equal(first.length, 1);
    assert.deepEqual(first, second);
    assert.equal(first[0]?.plannedSteps.length, 2);
    assert.equal(first[0]?.trustPolicySummary.scriptExecutionBlocked, true);
    assert.equal(first[0]?.trustPolicySummary.scriptsAutoExecutable, false);
    assert.equal(first[0]?.trustPolicySummary.scriptsRequireHumanApproval, true);
    assert.equal(loadCalls.length >= 2, true);
  });

  it('captures preview skill execution plans as journal records', async () => {
    const skillIndex = createSkillMetadataIndex([{
      skillPath: 'skills/validation/skill.md',
      markdown: `---
name: validation
description: Validate code changes with test build lint workflow.
version: 1.0.0
risk: low
allowedTools: [npm.cmd]
resourceHints: [package.json]
keywords: [validation, test, build, lint]
---
`,
    }]);

    const selected = selectAdaptivePreviewSkills({
      enabled: true,
      skillIndex,
      tasks: [{ id: 'task:validate', title: 'run test build lint validation' }],
      maxSelections: 1,
      maxMatchesPerTask: 1,
    });
    const plans = await buildAdaptivePreviewSkillExecutionPlans({
      enabled: true,
      skillSelections: selected,
      skillIndex,
      maxPlans: 1,
      maxStepsPerPlan: 2,
      loadSkillDocument: async (filePath): Promise<SkillDocument> => ({
        metadata: {
          name: 'validation',
          description: 'mock',
          version: '1.0.0',
          risk: 'low',
          allowedTools: ['npm.cmd'],
          resourceHints: [],
          keywords: [],
          skillPath: filePath,
        },
        body: '1. Run npm.cmd test\n2. Run npm.cmd run build\n3. Run npm.cmd run lint',
      }),
    });

    const preview = createAdaptiveQueuePreview({
      ...runtimeInputs,
      skillSelections: selected,
      skillExecutionPlans: plans,
    }, { enabled: true });
    const appended: EventJournalRecord[] = [];

    await captureAdaptivePreviewJournal(preview, {
      enabled: true,
      journalPath: 'ignored.json',
      appendRecords: async (_filePath, records) => {
        appended.push(...records);
        return [...records];
      },
      now: () => '2026-06-20T12:16:00.000Z',
      source: 'adapter-test',
    });

    const planRecord = appended.find(record => record.type === 'skill_execution_plan');
    assert.ok(planRecord && planRecord.type === 'skill_execution_plan');
    if (!planRecord || planRecord.type !== 'skill_execution_plan') {
      throw new Error('Expected a skill_execution_plan record to be appended.');
    }
    assert.equal(planRecord.plan.skillName, 'validation');
    assert.equal(planRecord.plan.trustPolicySummary.scriptExecutionBlocked, true);
    assert.equal(planRecord.plan.trustPolicySummary.scriptsAutoExecutable, false);
    assert.equal(planRecord.plan.plannedSteps.length, 2);
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
