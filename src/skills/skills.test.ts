import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseSkillDocument, parseSkillMetadata } from './loader.js';
import { createSkillMetadataIndex } from './registry.js';
import { selectSkillsForTask } from './selector.js';
import { evaluateSkillResourcePolicy, isSkillResourceExecutionAllowed } from './trust-policy.js';

async function readSkillMarkdown(skillName: string): Promise<string> {
  const skillPath = path.join(process.cwd(), 'skills', skillName, 'skill.md');
  return readFile(skillPath, 'utf8');
}

describe('skills front matter and metadata index', () => {
  it('enforces required front matter fields', () => {
    assert.throws(
      () => parseSkillMetadata('---\nname: only-name\n---\nbody'),
      /requires a non-empty "description" field/i,
    );
  });

  it('creates a metadata-only index with required fields', async () => {
    const repoInspection = await readSkillMarkdown('repo-inspection');
    const validation = await readSkillMarkdown('validation');
    const index = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: repoInspection },
      { skillPath: 'skills/validation/skill.md', markdown: validation },
    ], { now: () => '2026-06-23T00:00:00.000Z' });

    assert.equal(index.generatedAt, '2026-06-23T00:00:00.000Z');
    assert.equal(index.skills.length, 2);
    for (const skill of index.skills) {
      assert.ok(skill.name.length > 0);
      assert.ok(skill.description.length > 0);
      assert.ok(skill.version.length > 0);
      assert.ok(['low', 'medium', 'high'].includes(skill.risk));
      assert.ok(Array.isArray(skill.allowedTools));
      assert.ok(Array.isArray(skill.resourceHints));
      assert.equal(Object.prototype.hasOwnProperty.call(skill, 'body'), false);
    }
  });

  it('keeps progressive disclosure: body is loaded only from full document parser', async () => {
    const markdown = await readSkillMarkdown('typescript-patch');
    const metadata = parseSkillMetadata(markdown, 'skills/typescript-patch/skill.md');
    const document = parseSkillDocument(markdown, 'skills/typescript-patch/skill.md');

    assert.equal(Object.prototype.hasOwnProperty.call(metadata, 'body'), false);
    assert.ok(document.body.includes('Inspect relevant symbols first.'));
    assert.ok(document.body.length > 0);
  });
});

describe('deterministic skill selection', () => {
  it('selects validation skill for validation/test/build tasks', async () => {
    const index = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: await readSkillMarkdown('repo-inspection') },
      { skillPath: 'skills/typescript-patch/skill.md', markdown: await readSkillMarkdown('typescript-patch') },
      { skillPath: 'skills/validation/skill.md', markdown: await readSkillMarkdown('validation') },
      { skillPath: 'skills/error-recovery/skill.md', markdown: await readSkillMarkdown('error-recovery') },
    ]);

    const matches = selectSkillsForTask(index, {
      title: 'Run test build lint validation',
      description: 'Need validation summary after patch.',
    });

    assert.ok(matches.length > 0);
    assert.equal(matches[0].skill.name, 'validation');
  });

  it('returns no skills for unknown tasks by default', async () => {
    const index = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: await readSkillMarkdown('repo-inspection') },
      { skillPath: 'skills/typescript-patch/skill.md', markdown: await readSkillMarkdown('typescript-patch') },
    ]);

    const matches = selectSkillsForTask(index, {
      title: 'Unrelated poetry generation',
      description: 'Compose a sonnet about sunsets.',
    });
    assert.deepEqual(matches, []);
  });

  it('supports deterministic fallback skill when configured', async () => {
    const index = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: await readSkillMarkdown('repo-inspection') },
    ]);
    const matches = selectSkillsForTask(
      index,
      { title: 'Unknown task' },
      { fallbackSkillName: 'repo-inspection' },
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].skill.name, 'repo-inspection');
    assert.equal(matches[0].score, 0);
  });
});

describe('trust policy', () => {
  it('marks scripts as requiring human approval and non-executable by default', () => {
    const policy = evaluateSkillResourcePolicy('skills/example/scripts/fix.ps1');
    assert.equal(policy.kind, 'script');
    assert.equal(policy.requiresHumanApproval, true);
    assert.equal(policy.autoExecutable, false);
    assert.equal(isSkillResourceExecutionAllowed('skills/example/scripts/fix.ps1'), false);
  });

  it('allows markdown instructions and references for read-only loading', () => {
    const instructions = evaluateSkillResourcePolicy('skills/repo-inspection/skill.md');
    const reference = evaluateSkillResourcePolicy('skills/repo-inspection/references/git-cheatsheet.md');
    assert.equal(instructions.kind, 'instructions');
    assert.equal(instructions.readAllowed, true);
    assert.equal(reference.kind, 'reference');
    assert.equal(reference.readAllowed, true);
  });
});

describe('required skill content rules', () => {
  it('repo-inspection skill blocks full-file dumps and enforces bounded inspect-then-act', async () => {
    const document = parseSkillDocument(await readSkillMarkdown('repo-inspection'));
    assert.ok(document.body.includes('Do not use full-file Get-Content -Raw on large files by default.'));
    assert.ok(document.body.includes('After 2-3 inspection commands, patch, ask, or stop.'));
  });

  it('typescript-patch skill enforces bounded inspection before patching', async () => {
    const document = parseSkillDocument(await readSkillMarkdown('typescript-patch'));
    assert.ok(document.body.includes('Inspect relevant symbols first.'));
    assert.ok(document.body.includes('Bound inspection to only the files and line ranges needed before patching.'));
  });

  it('error-recovery skill turns failures into one next repair command', async () => {
    const document = parseSkillDocument(await readSkillMarkdown('error-recovery'));
    assert.ok(document.body.includes('Produce exactly one next repair command.'));
    assert.ok(document.body.includes('Avoid repeating the same broken command form.'));
    assert.ok(document.body.includes('Prefer here-string or temp-file scripts over fragile node -e quoting for multiline patches.'));
  });
});

describe('no production scheduling behavior changes', () => {
  it('metadata index generation is deterministic regardless of source order', async () => {
    const repoInspection = await readSkillMarkdown('repo-inspection');
    const validation = await readSkillMarkdown('validation');

    const left = createSkillMetadataIndex([
      { skillPath: 'skills/repo-inspection/skill.md', markdown: repoInspection },
      { skillPath: 'skills/validation/skill.md', markdown: validation },
    ]);

    const right = createSkillMetadataIndex([
      { skillPath: 'skills/validation/skill.md', markdown: validation },
      { skillPath: 'skills/repo-inspection/skill.md', markdown: repoInspection },
    ]);

    assert.deepEqual(left.skills.map(skill => skill.name), right.skills.map(skill => skill.name));
  });
});
