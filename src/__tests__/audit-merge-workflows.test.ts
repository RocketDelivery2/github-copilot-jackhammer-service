import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const repositoryRoot = process.cwd();
const auditScript = path.join(repositoryRoot, 'scripts', 'audit-merge-workflows.mjs');

function runAudit(files: string[]) {
  return spawnSync(process.execPath, [auditScript, ...files], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('merge workflow controls audit', () => {
  it('recognizes each merge step guarded by gate_pass or derived do_arm', () => {
    const result = runAudit([
      '.github/workflows/auto-merge.yml',
      '.github/workflows/dependabot-auto-merge.yml',
    ]);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /dependabot-auto-merge\.yml guarded merge execution path present/);
  });

  it('does not count a guard on an unrelated step as a merge guard', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'merge-workflow-audit-'));
    const workflowPath = path.join(directory, 'unguarded.yml');

    try {
      await writeFile(workflowPath, `name: unguarded
security breaking-change do-not-merge
jobs:
  merge:
    steps:
      - name: Gate summary
        if: steps.gates.outputs.gate_pass == 'true'
        run: echo gate passed
      - name: Merge
        run: gh pr merge 42
      - name: Summary
        run: echo summary >> "$GITHUB_STEP_SUMMARY"
`);
      const result = runAudit([workflowPath]);

      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /potential unconditional merge path/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('detects an unguarded merge after a shell command prefix', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'merge-workflow-audit-'));
    const workflowPath = path.join(directory, 'prefixed-unguarded.yml');

    try {
      await writeFile(workflowPath, `name: unguarded
security breaking-change do-not-merge
jobs:
  merge:
    steps:
      - name: Guarded merge
        if: steps.gates.outputs.gate_pass == 'true'
        run: gh pr merge 42
      - name: Unconditionally merge
        run: echo setup; gh pr merge 43
      - name: Summary
        run: echo summary >> "$GITHUB_STEP_SUMMARY"
`);
      const result = runAudit([workflowPath]);

      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /merge_count=2 guard_count=1/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('detects an unguarded quoted merge subcommand alongside a guarded merge', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'merge-workflow-audit-'));
    const workflowPath = path.join(directory, 'quoted-unguarded.yml');

    try {
      await writeFile(workflowPath, `name: unguarded
security breaking-change do-not-merge
jobs:
  merge:
    steps:
      - name: Guarded merge
        if: steps.gates.outputs.gate_pass == 'true'
        run: gh pr merge 42
      - name: Unconditionally merge
        run: gh pr 'merge' 43
      - name: Summary
        run: echo summary >> "$GITHUB_STEP_SUMMARY"
`);
      const result = runAudit([workflowPath]);

      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /merge_count=2 guard_count=1/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a do_arm merge step when the output is not derived from passed gates', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'merge-workflow-audit-'));
    const workflowPath = path.join(directory, 'unsafe-arm.yml');

    try {
      await writeFile(workflowPath, `name: unsafe
security breaking-change do-not-merge
DO_ARM=true
echo "do_arm=$DO_ARM"
jobs:
  merge:
    steps:
      - name: Merge
        if: steps.gates.outputs.do_arm == 'true'
        run: gh pr merge 42
      - name: Summary
        run: echo summary >> "$GITHUB_STEP_SUMMARY"
`);
      const result = runAudit([workflowPath]);

      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /derived do_arm output is not fail-closed/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
