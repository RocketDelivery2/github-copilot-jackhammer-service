import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { assertWorkflowGuards, WorkflowGuardError } from '../workflow-guards.js';

describe('workflow guards', () => {
  it('allows a valid workflow context', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jackhammer-guards-'));
    const eventPath = path.join(root, 'event.json');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'package.json'), '{}', 'utf8');
    await writeFile(path.join(root, 'tsconfig.json'), '{}', 'utf8');
    await writeFile(path.join(root, 'src', 'discussion-writer-cli.ts'), '', 'utf8');
    await writeFile(path.join(root, 'src', 'discussion-writer.ts'), '', 'utf8');
    await writeFile(eventPath, JSON.stringify({ repository: { default_branch: 'main' } }), 'utf8');

    await assertWorkflowGuards({
      workflowName: 'discussion-writer',
      cwd: root,
      eventName: 'workflow_dispatch',
      eventPath,
      allowedEvents: ['workflow_dispatch', 'schedule'],
      expectedDefaultBranch: 'main',
      requiredPaths: [
        'package.json',
        'tsconfig.json',
        'src/discussion-writer-cli.ts',
        'src/discussion-writer.ts',
      ],
    });
  });

  it('rejects invalid workflow triggers', async () => {
    await assert.rejects(
      () => assertWorkflowGuards({
        workflowName: 'discussion-writer',
        eventName: 'push',
        allowedEvents: ['workflow_dispatch', 'schedule'],
      }),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowGuardError);
        assert.equal(error.exitCode, 64);
        assert.match((error as Error).message, /unsupported trigger/i);
        return true;
      },
    );
  });

  it('rejects missing required files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jackhammer-guards-missing-'));
    await assert.rejects(
      () => assertWorkflowGuards({
        workflowName: 'discussion-writer',
        cwd: root,
        requiredPaths: ['package.json'],
      }),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowGuardError);
        assert.equal(error.exitCode, 66);
        assert.match((error as Error).message, /required path missing/i);
        return true;
      },
    );
  });

  it('rejects default branch mismatches', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jackhammer-guards-branch-'));
    const eventPath = path.join(root, 'event.json');
    await writeFile(eventPath, JSON.stringify({ repository: { default_branch: 'develop' } }), 'utf8');

    await assert.rejects(
      () => assertWorkflowGuards({
        workflowName: 'discussion-writer',
        cwd: root,
        eventPath,
        expectedDefaultBranch: 'main',
      }),
      (error: unknown) => {
        assert.ok(error instanceof WorkflowGuardError);
        assert.equal(error.exitCode, 64);
        assert.match((error as Error).message, /default branch/i);
        return true;
      },
    );
  });
});
