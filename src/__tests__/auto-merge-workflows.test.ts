import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const workflowPaths = [
  '.github/workflows/safe-automerge.yml',
  '.github/workflows/dependabot-auto-merge.yml',
] as const;

function readWorkflow(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('auto-merge workflows', () => {
  for (const path of workflowPaths) {
    it(`${path} has fail-closed triggers, permissions, and merge guards`, () => {
      const workflow = readWorkflow(path);

      assert.doesNotMatch(workflow, /^  pull_request(?:_review)?:/m);
      assert.match(workflow, /^permissions:\s*\{\s*\}$/m);

      const stepBlocks = workflow.split(/^      - name:/m).slice(1);
      const armSteps = stepBlocks.filter(step => /run:\s*gh pr merge --auto\b/.test(step));
      assert.ok(armSteps.length > 0, 'expected an auto-merge arm command');
      for (const step of armSteps) {
        assert.match(step, /^        if: steps\.gates\.outputs\.do_arm == 'true'$/m);
        assert.match(step, /gh pr merge --auto[^\n]*--match-head-commit/);
      }

      assert.match(workflow, /if: steps\.gates\.outputs\.gate_pass == 'false' && steps\.gates\.outputs\.auto_merge_enabled == 'true'/);
      assert.match(workflow, /gh pr merge "\$PR" --repo "\$REPO" --disable-auto/);
      assert.match(workflow, /Result: (?:native auto-merge disabled|disabling native auto-merge failed)/);
    });
  }
});
