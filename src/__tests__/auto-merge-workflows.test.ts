import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const workflowPaths = [
  '.github/workflows/safe-automerge.yml',
  '.github/workflows/dependabot-auto-merge.yml',
] as const;

function readWorkflow(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('#'))
    .join('\n');
}

describe('auto-merge workflows', () => {
  for (const path of workflowPaths) {
    it(`${path} has fail-closed triggers, permissions, and merge guards`, () => {
      const workflow = readWorkflow(path);

      assert.doesNotMatch(workflow, /^  pull_request(?:_review(?:_comment)?)?:/m);
      assert.match(workflow, /^permissions:\s*\{\s*\}$/m);

      const stepBlocks = workflow.split(/^      - name:/m).slice(1);
      const gatesStep = stepBlocks.find(step => /\bid: gates\b/.test(step));
      assert.ok(gatesStep, 'expected a policy evaluation step');
      assert.match(gatesStep, /^        if: steps\.resolve\.outputs\.pr_number != ''$/m);

      const armSteps = stepBlocks.filter(step => /gh pr merge\b[^\n]*--auto\b/.test(step));
      assert.ok(armSteps.length > 0, 'expected an auto-merge arm command');
      for (const step of armSteps) {
        assert.match(step, /^        if: steps\.resolve\.outputs\.pr_number != '' && steps\.gates\.outputs\.do_arm == 'true'$/m);
        assert.match(step, /gh pr merge --auto/);
        assert.match(step, /--match-head-commit/);
      }

      assert.match(gatesStep, /PR_REST_JSON=\$\(gh api "repos\/\$REPO\/pulls\/\$PR_NUMBER"\)/);
      assert.match(gatesStep, /\.auto_merge != null and \.auto_merge\.enabled_by\.login == "github-actions\[bot\]"/);
      assert.match(gatesStep, /--argjson pr_rest "\$PR_REST_JSON"/);
      assert.match(gatesStep, /author: \{login: \$pr_rest\.user\.login\}/);
      assert.match(workflow, /autoMergeEnabled: \$auto_merge_enabled/);
      assert.match(workflow, /^        if: always\(\) && steps\.resolve\.outputs\.pr_number != '' && \(steps\.gates\.outcome != 'success' \|\| steps\.gates\.outputs\.gate_pass == 'false'\)$/m);
      assert.match(workflow, /gh pr merge "\$PR_NUMBER" --repo "\$REPO" --disable-auto/);
      const disarmStep = stepBlocks.find(step => /GATES_OUTCOME: \$\{\{ steps\.gates\.outcome \}\}/.test(step));
      assert.ok(disarmStep, 'expected a native auto-merge disarm step');
      assert.match(disarmStep, /PR_REST_JSON=\$\(gh api "repos\/\$REPO\/pulls\/\$PR_NUMBER"\)/);
      assert.match(disarmStep, /\.auto_merge != null and \.auto_merge\.enabled_by\.login == "github-actions\[bot\]"/);
      assert.match(workflow, /Result: (?:native auto-merge disabled|disabling native auto-merge failed)/);
    });
  }

  it('keeps general and Dependabot PR populations disjoint', () => {
    const safeAutomerge = readWorkflow('.github/workflows/safe-automerge.yml');
    const dependabotAutomerge = readWorkflow('.github/workflows/dependabot-auto-merge.yml');

    assert.match(safeAutomerge, /if \[\[ "\$HEAD_REF_NAME" == dependabot\/\* \]\]/);
    assert.match(safeAutomerge, /echo "pr_number=" >> "\$GITHUB_OUTPUT"/);
    assert.match(dependabotAutomerge, /if \[\[ "\$HEAD_REF_NAME" != dependabot\/\* \]\]/);
    assert.match(dependabotAutomerge, /echo "pr_number=\$PR_NUMBER" >> "\$GITHUB_OUTPUT"/);
    assert.match(safeAutomerge, /if: steps\.resolve\.outputs\.pr_number != ''/);
    assert.match(dependabotAutomerge, /if: steps\.resolve\.outputs\.pr_number != ''/);
  });
});
