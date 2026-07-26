import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateDefaultSkillTrustPolicy, normalizeSkillBasePath } from './skill-policy-gating.js';

describe('skill policy gating strategy', () => {
  it('normalizes skill base paths consistently', () => {
    assert.equal(normalizeSkillBasePath('skills/validation/skill.md', 'validation'), 'skills/validation');
    assert.equal(normalizeSkillBasePath('skills\\validation\\skill.md', 'validation'), 'skills/validation');
    assert.equal(normalizeSkillBasePath('skills/custom', 'custom'), 'skills/custom');
    assert.equal(normalizeSkillBasePath('   ', 'fallback'), 'skills/fallback');
  });

  it('builds deterministic default trust-policy summaries', () => {
    const summary = evaluateDefaultSkillTrustPolicy({
      skillPath: 'skills/typescript-patch/skill.md',
      skillName: 'typescript-patch',
    });

    assert.deepEqual(summary, {
      instructionsReadAllowed: true,
      referencesReadAllowed: true,
      assetsReadAllowed: true,
      scriptsRequireHumanApproval: true,
      scriptsAutoExecutable: false,
    });
  });
});
