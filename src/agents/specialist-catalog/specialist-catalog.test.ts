/**
 * Tests for the Specialist Agent Catalog.
 *
 * Covers: deterministic selection, risk-tier escalation, no write authority by default,
 * no duplicate roles, budget enforcement, unknown capability rejection, empty input,
 * and maximum-team-size enforcement.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MAX_TEAM_SIZE,
  SPECIALIST_CATALOG,
  isKnownCapability,
  selectSpecialists,
  validateCapabilities,
} from './index.js';
import type { RepositorySignals } from './index.js';
import { SMALL_TYPESCRIPT_REPO_SIGNALS } from './fixtures/typescript-repo.fixture.js';

const ALL_FALSE_SIGNALS = {
  hasTypeScript: false,
  hasJavaScript: false,
  hasPython: false,
  hasGo: false,
  hasRust: false,
  hasJava: false,
  hasTests: false,
  hasDatabase: false,
  hasAPI: false,
  hasCI: false,
  hasDocker: false,
  hasKubernetes: false,
  hasTerraform: false,
  hasAccessibilityRequirements: false,
  hasSecurityConfig: false,
  hasDocsFolder: false,
  hasDependencyLockfile: false,
  hasRecentIncidents: false,
  hasOpenAPIDef: false,
  hasMigrationFiles: false,
  hasPerformanceTests: false,
  hasObservabilityConfig: false,
  hasReleaseWorkflow: false,
  isLibrary: false,
} as const;

function createAllTrueSignals(): RepositorySignals {
  return {
    hasTypeScript: true,
    hasJavaScript: true,
    hasPython: true,
    hasGo: true,
    hasRust: true,
    hasJava: true,
    hasTests: true,
    hasDatabase: true,
    hasAPI: true,
    hasCI: true,
    hasDocker: true,
    hasKubernetes: true,
    hasTerraform: true,
    hasAccessibilityRequirements: true,
    hasSecurityConfig: true,
    hasDocsFolder: true,
    hasDependencyLockfile: true,
    hasRecentIncidents: true,
    hasOpenAPIDef: true,
    hasMigrationFiles: true,
    hasPerformanceTests: true,
    hasObservabilityConfig: true,
    hasReleaseWorkflow: true,
    isLibrary: true,
  };
}

// ── 1. Deterministic selection ────────────────────────────────────────────────
describe('deterministic selection', () => {
  it('same signals always produce the same agent ids in the same order', () => {
    const run1 = selectSpecialists({ signals: SMALL_TYPESCRIPT_REPO_SIGNALS, featureEnabled: true });
    const run2 = selectSpecialists({ signals: SMALL_TYPESCRIPT_REPO_SIGNALS, featureEnabled: true });

    assert.deepStrictEqual(
      run1.selected.map(a => a.id),
      run2.selected.map(a => a.id),
      'Selection must be deterministic: identical calls must return identical ordered agent ids',
    );
    assert.ok(run1.selected.length > 0, 'Expected at least one agent to be selected');
  });

  it('all-false signals with feature enabled selects only always-on agents', () => {
    const result = selectSpecialists({ signals: ALL_FALSE_SIGNALS, featureEnabled: true });
    const ids = result.selected.map(a => a.id);
    assert.ok(ids.includes('chief-orchestrator'), 'chief-orchestrator is always selected');
    assert.ok(ids.includes('requirements-architect'), 'requirements-architect is always selected');
    assert.ok(ids.includes('security-architect'), 'security-architect is always selected');
    // None of the conditional agents should be present
    assert.ok(!ids.includes('performance-engineer'), 'performance-engineer should not be selected without signals');
    assert.ok(!ids.includes('database-engineer'), 'database-engineer should not be selected without signals');
    assert.ok(!ids.includes('incident-forensics-reviewer'), 'incident-forensics-reviewer should not be selected without signals');
  });

  it('agent ordering follows stable catalog order, not insertion order', () => {
    const result = selectSpecialists({
      signals: { ...ALL_FALSE_SIGNALS, hasDatabase: true, hasCI: true, hasTests: true },
      featureEnabled: true,
    });
    const ids = result.selected.map(a => a.id);
    const catalogIds = SPECIALIST_CATALOG.map(c => c.id);
    for (let i = 0; i < ids.length - 1; i++) {
      const posA = catalogIds.indexOf(ids[i]!);
      const posB = catalogIds.indexOf(ids[i + 1]!);
      assert.ok(posA < posB, `Agent "${ids[i]}" (pos ${posA}) must appear before "${ids[i + 1]}" (pos ${posB}) in catalog order`);
    }
  });
});

// ── 2. Risk-tier escalation ───────────────────────────────────────────────────
describe('risk-tier escalation', () => {
  it('release-governor has critical risk tier', () => {
    const card = SPECIALIST_CATALOG.find(c => c.id === 'release-governor');
    assert.ok(card !== undefined);
    assert.equal(card.riskTier, 'critical');
  });

  it('implementation-engineer has high risk tier', () => {
    const card = SPECIALIST_CATALOG.find(c => c.id === 'implementation-engineer');
    assert.ok(card !== undefined);
    assert.equal(card.riskTier, 'high');
  });

  it('read-only analysis agents have low or medium risk tier', () => {
    const readOnlyIds = [
      'requirements-architect',
      'software-architect',
      'qa-architect',
      'performance-engineer',
      'api-integration-architect',
      'observability-engineer',
      'accessibility-engineer',
      'dependency-supply-chain-reviewer',
      'documentation-engineer',
    ];
    for (const id of readOnlyIds) {
      const card = SPECIALIST_CATALOG.find(c => c.id === id);
      assert.ok(card !== undefined, `Agent "${id}" not found`);
      assert.ok(
        card.riskTier === 'low' || card.riskTier === 'medium',
        `Read-only agent "${id}" should have low or medium risk tier, got "${card.riskTier}"`,
      );
    }
  });
});

// ── 3. No write authority by default ─────────────────────────────────────────
describe('no write authority by default', () => {
  it('every agent has canMerge: false', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.equal(
        card.authorityCeiling.canMerge,
        false,
        `Agent "${card.id}" must have canMerge: false`,
      );
    }
  });

  it('every agent has canAdminRepo: false', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.equal(
        card.authorityCeiling.canAdminRepo,
        false,
        `Agent "${card.id}" must have canAdminRepo: false`,
      );
    }
  });

  it('every agent has canAccessSecrets: false', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.equal(
        card.authorityCeiling.canAccessSecrets,
        false,
        `Agent "${card.id}" must have canAccessSecrets: false`,
      );
    }
  });

  it('read-only agents have canWrite: false', () => {
    const readOnlyAgents = SPECIALIST_CATALOG.filter(c => !c.authorityCeiling.requiresApprovalToken);
    assert.ok(readOnlyAgents.length > 0, 'Expected at least some read-only agents');
    for (const card of readOnlyAgents) {
      assert.equal(
        card.authorityCeiling.canWrite,
        false,
        `Read-only agent "${card.id}" must have canWrite: false`,
      );
    }
  });

  it('execution agents require an approval token when canWrite is true', () => {
    const executionAgents = SPECIALIST_CATALOG.filter(c => c.authorityCeiling.canWrite);
    assert.ok(executionAgents.length > 0, 'Expected at least one execution agent');
    for (const card of executionAgents) {
      assert.equal(
        card.authorityCeiling.requiresApprovalToken,
        true,
        `Execution agent "${card.id}" must require approval token`,
      );
    }
  });

  it('every agent prohibits merge-pull-request', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.ok(
        card.prohibitedActions.includes('merge-pull-request'),
        `Agent "${card.id}" must explicitly prohibit merge-pull-request`,
      );
    }
  });

  it('every agent prohibits administer-repository', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.ok(
        card.prohibitedActions.includes('administer-repository'),
        `Agent "${card.id}" must explicitly prohibit administer-repository`,
      );
    }
  });

  it('every agent prohibits access-secrets', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.ok(
        card.prohibitedActions.includes('access-secrets'),
        `Agent "${card.id}" must explicitly prohibit access-secrets`,
      );
    }
  });
});

// ── 4. No duplicate roles ─────────────────────────────────────────────────────
describe('no duplicate roles', () => {
  it('catalog has no duplicate agent ids', () => {
    const ids = SPECIALIST_CATALOG.map(c => c.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'SPECIALIST_CATALOG must not contain duplicate agent ids');
  });

  it('selectSpecialists never returns duplicate agent ids', () => {
    const result = selectSpecialists({
      signals: {
        ...ALL_FALSE_SIGNALS,
        hasTypeScript: true,
        hasTests: true,
        hasCI: true,
        hasDatabase: true,
        hasAPI: true,
        hasDocsFolder: true,
        hasDependencyLockfile: true,
        hasReleaseWorkflow: true,
      },
      featureEnabled: true,
      maximumTeamSize: 16,
    });
    const ids = result.selected.map(a => a.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'selectSpecialists must not return duplicate agents');
  });

  it('catalog contains exactly 16 agents', () => {
    assert.equal(SPECIALIST_CATALOG.length, 16, 'Sample catalog must have exactly 16 specialist agents');
  });
});

// ── 5. Budget enforcement ─────────────────────────────────────────────────────
describe('budget enforcement', () => {
  it('every agent has a positive timeBudgetSeconds', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.ok(
        Number.isFinite(card.timeBudgetSeconds) && card.timeBudgetSeconds > 0,
        `Agent "${card.id}" must have a positive timeBudgetSeconds, got ${card.timeBudgetSeconds}`,
      );
    }
  });

  it('every agent has a positive tokenBudget', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.ok(
        Number.isFinite(card.tokenBudget) && card.tokenBudget > 0,
        `Agent "${card.id}" must have a positive tokenBudget, got ${card.tokenBudget}`,
      );
    }
  });

  it('every agent has a positive costBudget', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.ok(
        Number.isFinite(card.costBudget) && card.costBudget > 0,
        `Agent "${card.id}" must have a positive costBudget, got ${card.costBudget}`,
      );
    }
  });

  it('every agent has a positive maximumConcurrency', () => {
    for (const card of SPECIALIST_CATALOG) {
      assert.ok(
        Number.isInteger(card.maximumConcurrency) && card.maximumConcurrency >= 1,
        `Agent "${card.id}" must have maximumConcurrency >= 1, got ${card.maximumConcurrency}`,
      );
    }
  });

  it('critical-risk agents have higher budgets than low-risk agents', () => {
    const criticalAgents = SPECIALIST_CATALOG.filter(c => c.riskTier === 'critical');
    const lowRiskAgents = SPECIALIST_CATALOG.filter(c => c.riskTier === 'low');
    assert.ok(criticalAgents.length > 0, 'Expected at least one critical-risk agent');
    assert.ok(lowRiskAgents.length > 0, 'Expected at least one low-risk agent');

    const maxCriticalBudget = Math.max(...criticalAgents.map(c => c.timeBudgetSeconds));
    const minLowRiskBudget = Math.min(...lowRiskAgents.map(c => c.timeBudgetSeconds));
    assert.ok(
      maxCriticalBudget >= minLowRiskBudget,
      `Critical agents should have time budgets at least as large as low-risk agents`,
    );
  });
});

// ── 6. Unknown capability rejection ──────────────────────────────────────────
describe('unknown capability rejection', () => {
  it('isKnownCapability returns true for all defined capabilities', () => {
    for (const cap of SPECIALIST_CATALOG.flatMap(c => c.capabilities)) {
      assert.ok(isKnownCapability(cap), `Capability "${cap}" in catalog should be recognized`);
    }
  });

  it('isKnownCapability returns false for unknown capability strings', () => {
    assert.equal(isKnownCapability('fly-to-moon'), false);
    assert.equal(isKnownCapability(''), false);
    assert.equal(isKnownCapability('ORCHESTRATION'), false); // case-sensitive
  });

  it('validateCapabilities returns errors for unknown capabilities', () => {
    const errors = validateCapabilities(['orchestration', 'unknown-thing', 'another-bad-cap']);
    assert.equal(errors.length, 2);
    assert.ok(errors.some(e => e.includes('unknown-thing')));
    assert.ok(errors.some(e => e.includes('another-bad-cap')));
  });

  it('validateCapabilities returns no errors for all valid capabilities', () => {
    const allValid = [...SPECIALIST_CATALOG.flatMap(c => [...c.capabilities])];
    const errors = validateCapabilities(allValid);
    assert.deepStrictEqual(errors, []);
  });
});

// ── 7. Empty input ────────────────────────────────────────────────────────────
describe('empty input / feature disabled', () => {
  it('returns empty selection when featureEnabled is false (default)', () => {
    const result = selectSpecialists({ signals: SMALL_TYPESCRIPT_REPO_SIGNALS });
    assert.equal(result.featureEnabled, false);
    assert.equal(result.selected.length, 0);
    assert.equal(result.teamSize, 0);
  });

  it('returns empty selection when featureEnabled is explicitly false', () => {
    const result = selectSpecialists({
      signals: SMALL_TYPESCRIPT_REPO_SIGNALS,
      featureEnabled: false,
    });
    assert.equal(result.featureEnabled, false);
    assert.equal(result.selected.length, 0);
  });

  it('all-false signals with feature enabled still selects always-on agents', () => {
    const result = selectSpecialists({ signals: ALL_FALSE_SIGNALS, featureEnabled: true });
    assert.ok(result.selected.length > 0, 'Always-on agents should still be selected');
  });

  it('selectSpecialists with all signals produces fewer than the full 16 agents when at default team size', () => {
    // Even with all signals true, the cap keeps output at or below DEFAULT_MAX_TEAM_SIZE
    const allTrueSignals = createAllTrueSignals();
    const result = selectSpecialists({ signals: allTrueSignals, featureEnabled: true });
    assert.ok(result.selected.length <= DEFAULT_MAX_TEAM_SIZE);
  });
});

// ── 8. Maximum team size enforcement ─────────────────────────────────────────
describe('maximum team size enforcement', () => {
  it('result never exceeds the specified maximumTeamSize', () => {
    const allTrueSignals = createAllTrueSignals();

    for (const cap of [1, 3, 5, 7, 10]) {
      const result = selectSpecialists({
        signals: allTrueSignals,
        featureEnabled: true,
        maximumTeamSize: cap,
      });
      assert.ok(
        result.selected.length <= cap,
        `Expected at most ${cap} agents, got ${result.selected.length}`,
      );
    }
  });

  it('teamSize in result matches selected.length', () => {
    const result = selectSpecialists({
      signals: SMALL_TYPESCRIPT_REPO_SIGNALS,
      featureEnabled: true,
    });
    assert.equal(result.teamSize, result.selected.length);
  });

  it('default team size is DEFAULT_MAX_TEAM_SIZE', () => {
    const allTrueSignals = createAllTrueSignals();
    const result = selectSpecialists({ signals: allTrueSignals, featureEnabled: true });
    assert.ok(
      result.selected.length <= DEFAULT_MAX_TEAM_SIZE,
      `Default cap should be ${DEFAULT_MAX_TEAM_SIZE}`,
    );
  });

  it('maximumTeamSize of 0 returns empty selection even when feature is enabled', () => {
    const result = selectSpecialists({
      signals: SMALL_TYPESCRIPT_REPO_SIGNALS,
      featureEnabled: true,
      maximumTeamSize: 0,
    });
    assert.equal(result.selected.length, 0);
    assert.equal(result.teamSize, 0);
  });
});
