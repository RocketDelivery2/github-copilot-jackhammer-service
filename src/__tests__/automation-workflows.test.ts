import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const WORKFLOW_DIR = path.join(process.cwd(), '.github', 'workflows');
const SAFE_AUTOMERGE = 'safe-automerge.yml';
const CONTROLS_AUDIT = 'controls-audit.yml';

function workflow(name: string): string {
  return readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');
}

/** Workflow text with comment lines removed, so documentation cannot satisfy or trip a check. */
function code(name: string): string {
  return workflow(name).split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');
}

function workflowNames(): string[] {
  return readdirSync(WORKFLOW_DIR).filter(name => name.endsWith('.yml') || name.endsWith('.yaml')).sort();
}

/** Returns the text of one top-level job block. */
function jobBlock(text: string, job: string): string {
  const start = text.indexOf(`\n  ${job}:\n`);
  assert.ok(start >= 0, `job ${job} not found`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next >= 0 ? rest.slice(0, next + 1) : rest;
}

describe('automation workflow guardrails', () => {
  it('has exactly one merging workflow and no approving workflows', () => {
    for (const name of workflowNames()) {
      if (name === CONTROLS_AUDIT) continue;
      const text = code(name);
      assert.doesNotMatch(text, /gh pr review[^\n#]*--approve/, `${name} must not approve PRs`);
      assert.doesNotMatch(text, /event:\s*['"]?APPROVE/, `${name} must not approve PRs`);
      assert.doesNotMatch(text, /gh pr merge[^\n#]*--admin/, `${name} must not bypass branch protection`);
      assert.doesNotMatch(text, /gh pr merge[^\n#]*--auto/, `${name} must not arm --auto merges`);
      if (name !== SAFE_AUTOMERGE) {
        assert.doesNotMatch(text, /gh pr merge/, `${name} must not merge PRs`);
      }
    }
  });

  it('retires the Dependabot self-approval and broken auto-merge workflows', () => {
    assert.equal(existsSync(path.join(WORKFLOW_DIR, 'dependabot-auto-approve.yml')), false);
    assert.equal(existsSync(path.join(WORKFLOW_DIR, 'dependabot-auto-merge.yml')), false);
  });

  it('never runs safe-automerge in a PR-controlled context', () => {
    const text = code(SAFE_AUTOMERGE);
    assert.doesNotMatch(text, /^\s+pull_request(_target|_review)?:/m);
    assert.match(text, /^\s+workflow_run:/m);
    assert.match(text, /ref: main\n/);
    assert.match(text, /persist-credentials: false/);
    assert.doesNotMatch(text, /head\.(ref|sha)|headRefName \}\}|refs\/pull/);
  });

  it('keeps safe-automerge least-privilege and split by job', () => {
    const text = code(SAFE_AUTOMERGE);
    assert.match(text, /^permissions: \{\}$/m);

    const evaluate = jobBlock(text, 'evaluate');
    assert.doesNotMatch(evaluate, /:\s*write/, 'evaluate job must be read-only');
    assert.doesNotMatch(evaluate, /gh pr merge/);
    assert.match(evaluate, /automerge-eligibility-cli\.ts/);

    const merge = jobBlock(text, 'merge');
    assert.match(merge, /contents: write/);
    assert.match(merge, /pull-requests: write/);
    assert.doesNotMatch(merge, /actions\/checkout|npm ci|issues: write|actions: write|administration/);
    assert.match(merge, /vars\.AUTOMERGE_MODE == 'enforce'/);
    assert.match(merge, /gh pr merge "\$PR" --repo "\$REPO" --squash --match-head-commit "\$SHA"/);
  });

  it('does not let auto-merge.yml approve or merge', () => {
    const text = code('auto-merge.yml');
    assert.doesNotMatch(text, /approve-and-merge|contents: write/);
    assert.doesNotMatch(text, /^\s+pull_request(_target)?:/m);
  });
});
