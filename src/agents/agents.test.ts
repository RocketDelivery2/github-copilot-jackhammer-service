import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createDefaultAgentRegistry,
  findAgentsByCapability,
  getAgentById,
  selectAgentsForWorkItem,
} from './registry.js';
import { createDelegationMessage, planRoundTable } from './delegation.js';
import { estimateAgentCostTier, validateAgentCard } from './policy.js';

const REQUIRED_AGENT_IDS = [
  'orchestrator',
  'product-manager',
  'software-architect',
  'multi-agent-systems-architect',
  'minimal-change-engineer',
  'code-reviewer',
  'security-architect',
  'appsec-engineer',
  'qa-test-engineer',
  'test-results-analyzer',
  'devops-sre',
  'cost-optimizer',
  'technical-writer',
  'release-manager',
] as const;

describe('agent registry — required agents and validation', () => {
  it('default registry contains all required agents', () => {
    const registry = createDefaultAgentRegistry();
    assert.equal(registry.agents.length, REQUIRED_AGENT_IDS.length);
    for (const id of REQUIRED_AGENT_IDS) {
      const agent = getAgentById(registry, id);
      assert.ok(agent !== undefined, `Agent '${id}' not found in default registry`);
      assert.equal(agent.id, id);
    }
  });

  it('every default agent card validates', () => {
    const registry = createDefaultAgentRegistry();
    for (const agent of registry.agents) {
      const result = validateAgentCard(agent);
      assert.ok(result.valid, `Agent '${agent.id}' failed validation: ${result.errors.join(', ')}`);
    }
  });

  it('getAgentById returns undefined for unknown id', () => {
    const registry = createDefaultAgentRegistry();
    assert.equal(getAgentById(registry, 'unknown-agent-xyz'), undefined);
  });

  it('findAgentsByCapability returns only agents with the matching capability', () => {
    const registry = createDefaultAgentRegistry();
    const agents = findAgentsByCapability(registry, 'release-management');
    assert.ok(agents.length > 0, 'Expected at least one agent with release-management capability');
    for (const agent of agents) {
      assert.ok(
        agent.capabilities.includes('release-management'),
        `Agent '${agent.id}' was returned but lacks release-management capability`,
      );
    }
  });
});

describe('agent selection for work items', () => {
  it('code-review tasks select code-reviewer and minimal-change-engineer', () => {
    const registry = createDefaultAgentRegistry();
    const selected = selectAgentsForWorkItem(registry, {
      kind: 'code-review',
      title: 'Review PR changes',
    });
    const ids = selected.map(a => a.id);
    assert.ok(ids.includes('code-reviewer'), 'code-reviewer not selected');
    assert.ok(ids.includes('minimal-change-engineer'), 'minimal-change-engineer not selected');
  });

  it('architecture tasks select software-architect', () => {
    const registry = createDefaultAgentRegistry();
    const selected = selectAgentsForWorkItem(registry, {
      kind: 'feature',
      title: 'Architecture design for new module',
    });
    const ids = selected.map(a => a.id);
    assert.ok(ids.includes('software-architect'), 'software-architect not selected');
  });

  it('multi-agent/A2A/MCP tasks select multi-agent-systems-architect and security-architect', () => {
    const registry = createDefaultAgentRegistry();
    const selected = selectAgentsForWorkItem(registry, {
      title: 'A2A communication protocol integration',
    });
    const ids = selected.map(a => a.id);
    assert.ok(ids.includes('multi-agent-systems-architect'), 'multi-agent-systems-architect not selected');
    assert.ok(ids.includes('security-architect'), 'security-architect not selected');
  });

  it('validation/test tasks select qa-test-engineer and test-results-analyzer', () => {
    const registry = createDefaultAgentRegistry();
    const selected = selectAgentsForWorkItem(registry, {
      kind: 'validation',
      title: 'Test suite coverage analysis',
    });
    const ids = selected.map(a => a.id);
    assert.ok(ids.includes('qa-test-engineer'), 'qa-test-engineer not selected');
    assert.ok(ids.includes('test-results-analyzer'), 'test-results-analyzer not selected');
  });

  it('release tasks select release-manager and devops-sre', () => {
    const registry = createDefaultAgentRegistry();
    const selected = selectAgentsForWorkItem(registry, {
      kind: 'release',
      title: 'Deploy v2 release to production',
    });
    const ids = selected.map(a => a.id);
    assert.ok(ids.includes('release-manager'), 'release-manager not selected');
    assert.ok(ids.includes('devops-sre'), 'devops-sre not selected');
  });

  it('unclassified tasks fall back to orchestrator', () => {
    const registry = createDefaultAgentRegistry();
    const selected = selectAgentsForWorkItem(registry, { title: 'miscellaneous unclassified work' });
    const ids = selected.map(a => a.id);
    assert.ok(ids.includes('orchestrator'), 'orchestrator should handle unclassified tasks');
    assert.equal(ids.length, 1, 'Only orchestrator should be selected for unclassified work');
  });

  it('selected agent list contains no duplicates', () => {
    const registry = createDefaultAgentRegistry();
    // Title that triggers multiple patterns
    const selected = selectAgentsForWorkItem(registry, {
      title: 'Architecture review of A2A agent protocol integration',
    });
    const ids = selected.map(a => a.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, 'selectAgentsForWorkItem should not return duplicate agents');
  });
});

describe('high-risk / destructive operations require human approval', () => {
  it('every default agent has at least one human approval requirement', () => {
    const registry = createDefaultAgentRegistry();
    for (const agent of registry.agents) {
      assert.ok(
        agent.requiresHumanApprovalFor.length > 0,
        `Agent '${agent.id}' has no human approval requirements`,
      );
    }
  });

  it('release-manager requires human approval for production releases', () => {
    const registry = createDefaultAgentRegistry();
    const releaseManager = getAgentById(registry, 'release-manager')!;
    assert.ok(
      releaseManager.requiresHumanApprovalFor.some(r => /production|release|deploy/i.test(r)),
      'release-manager should require human approval for production releases',
    );
  });

  it('devops-sre requires human approval for infrastructure changes', () => {
    const registry = createDefaultAgentRegistry();
    const devops = getAgentById(registry, 'devops-sre')!;
    assert.ok(
      devops.requiresHumanApprovalFor.some(r => /infra|pipeline|deploy/i.test(r)),
      'devops-sre should require human approval for infrastructure/pipeline changes',
    );
  });
});

describe('round-table planning', () => {
  it('deduplicates agents and respects max participants', () => {
    const registry = createDefaultAgentRegistry();
    const plan = planRoundTable(
      registry,
      'Security architecture review',
      ['security-review', 'appsec-review', 'architecture-design'],
      { maxParticipants: 3, now: () => '2026-06-23T00:00:00.000Z' },
    );
    const ids = plan.participants.map(a => a.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, 'Round-table participants should be deduplicated');
    assert.ok(
      plan.participants.length <= 3,
      `Expected at most 3 participants, got ${plan.participants.length}`,
    );
    assert.equal(plan.topic, 'Security architecture review');
    assert.equal(plan.maxParticipants, 3);
    assert.equal(plan.createdAt, '2026-06-23T00:00:00.000Z');
  });

  it('empty capabilities produce an empty participant list', () => {
    const registry = createDefaultAgentRegistry();
    const plan = planRoundTable(registry, 'No-op topic', []);
    assert.deepEqual(plan.participants, []);
    assert.equal(plan.topic, 'No-op topic');
  });
});

describe('delegation messages', () => {
  it('creates delegation messages with all required fields', () => {
    const msg = createDelegationMessage({
      fromAgentId: 'orchestrator',
      toAgentId: 'code-reviewer',
      topic: 'Review PR #42',
      payload: { prNumber: 42 },
      now: () => '2026-06-23T00:00:00.000Z',
      generateId: () => 'test-id-001',
    });
    assert.equal(msg.fromAgentId, 'orchestrator');
    assert.equal(msg.toAgentId, 'code-reviewer');
    assert.equal(msg.topic, 'Review PR #42');
    assert.deepEqual(msg.payload, { prNumber: 42 });
    assert.equal(msg.createdAt, '2026-06-23T00:00:00.000Z');
    assert.equal(msg.id, 'test-id-001');
    assert.equal(msg.priority, 'medium');
    assert.deepEqual(msg.requiredCapabilities, []);
  });

  it('accepts optional priority and required capabilities', () => {
    const msg = createDelegationMessage({
      fromAgentId: 'orchestrator',
      toAgentId: 'security-architect',
      topic: 'Security review',
      payload: {},
      priority: 'urgent',
      requiredCapabilities: ['security-review'],
      generateId: () => 'test-id-002',
      now: () => '2026-06-23T00:00:00.000Z',
    });
    assert.equal(msg.priority, 'urgent');
    assert.deepEqual(msg.requiredCapabilities, ['security-review']);
  });
});

describe('agent cost tier estimation', () => {
  it('bumps cost tier for high-risk tasks', () => {
    const registry = createDefaultAgentRegistry();
    const agent = getAgentById(registry, 'orchestrator')!;
    const lowRisk = estimateAgentCostTier(agent, 'low');
    const criticalRisk = estimateAgentCostTier(agent, 'critical');
    const tierRanks = ['low', 'medium', 'high', 'critical'];
    assert.ok(
      tierRanks.indexOf(criticalRisk) >= tierRanks.indexOf(lowRisk),
      'High-risk tasks should produce equal or higher cost tier',
    );
  });

  it('cost tier is capped at critical', () => {
    const registry = createDefaultAgentRegistry();
    const agent = getAgentById(registry, 'release-manager')!;
    const result = estimateAgentCostTier(agent, 'critical');
    assert.equal(result, 'critical', 'Cost tier should be capped at critical');
  });

  it('low-risk tasks on a low-tier agent stay at low', () => {
    const registry = createDefaultAgentRegistry();
    const agent = getAgentById(registry, 'cost-optimizer')!;
    assert.equal(agent.maxCostTier, 'low');
    const result = estimateAgentCostTier(agent, 'low');
    assert.equal(result, 'low');
  });
});

describe('no runtime scheduling behavior changes', () => {
  it('agent registry is deterministic and has no side effects', () => {
    const registry1 = createDefaultAgentRegistry();
    const registry2 = createDefaultAgentRegistry();
    assert.equal(registry1.agents.length, registry2.agents.length);
    assert.deepStrictEqual(
      registry1.agents.map(a => a.id),
      registry2.agents.map(a => a.id),
      'Registry agent order should be stable and deterministic',
    );
  });

  it('agent model functions are synchronous pure functions with no scheduling side effects', () => {
    const registry = createDefaultAgentRegistry();
    // All calls below must be synchronous and produce stable output with no I/O.
    const selected = selectAgentsForWorkItem(registry, { kind: 'feature', title: 'any task' });
    assert.ok(Array.isArray(selected));
    const plan = planRoundTable(registry, 'test topic', ['code-review']);
    assert.ok(Array.isArray(plan.participants));
    const msg = createDelegationMessage({
      fromAgentId: 'orchestrator',
      toAgentId: 'code-reviewer',
      topic: 'test',
      payload: {},
    });
    assert.equal(typeof msg.id, 'string');
    assert.ok(msg.id.length > 0);
  });
});
