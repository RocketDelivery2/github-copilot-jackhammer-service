import assert from 'node:assert/strict';
import process from 'node:process';
import { describe, it } from 'node:test';
import { createAdaptiveQueuePreview } from './adapter.js';
import {
  commandResultToExecutionEvents,
  commandResultToQueueSignals,
  executeCommandCapture,
} from './command-runner.js';

describe('command runner capture', () => {
  it('captures stdout and exitCode 0 for successful commands', async () => {
    const result = await executeCommandCapture({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("ok")'],
      cwd: process.cwd(),
      timeoutMs: 1_000,
      workItemId: 'command:success',
    });

    assert.equal(result.stdout, 'ok');
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.cwd, process.cwd());
    assert.equal(result.workItemId, 'command:success');
    assert.ok(Date.parse(result.startedAt));
    assert.ok(Date.parse(result.completedAt));
    assert.ok(result.durationMs >= 0);
  });

  it('captures stderr and nonzero exitCode for failing commands', async () => {
    const result = await executeCommandCapture({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("npm run lint\\nESLint found 1 error"); process.exit(2)'],
      timeoutMs: 1_000,
      workItemId: 'command:failure',
    });

    assert.match(result.stderr, /ESLint found 1 error/);
    assert.equal(result.exitCode, 2);
    assert.equal(result.timedOut, false);
  });

  it('marks timedOut true when a command exceeds its timeout', async () => {
    const result = await executeCommandCapture({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => process.stdout.write("late"), 1000)'],
      timeoutMs: 50,
      workItemId: 'command:timeout',
    });

    assert.equal(result.timedOut, true);
    assert.ok(result.durationMs >= 0);
    assert.ok(result.durationMs < 2_000);
  });

  it('converts command results into execution events and queue signals', async () => {
    const result = await executeCommandCapture({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("npm test failed with assertion error"); process.exit(1)'],
      timeoutMs: 1_000,
      workItemId: 'validate:test',
    });

    const events = commandResultToExecutionEvents(result);
    const signals = commandResultToQueueSignals(result);

    assert.deepEqual(events.map(event => event.kind), ['started', 'stderr', 'exit', 'failed']);
    assert.equal(events[0]?.workItemId, 'validate:test');
    assert.equal(signals[0]?.kind, 'test_failure');
    assert.equal(signals[0]?.workItemId, 'validate:test');
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
