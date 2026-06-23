# JackHammer Agent Operating Model

## Overview

JackHammer's agent operating model defines a set of specialist agents that can be composed, delegated to, and round-tabled for complex software-engineering work. Each agent is represented as a typed `AgentCard` — a JSON-serializable declaration of identity, capabilities, tool access boundaries, cost tier, safety rules, and handoff targets.

This model is currently **type-only and production-isolated**: it ships as pure TypeScript functions with no runtime side effects, no network calls, and no production scheduling wires. Future PRs will connect the model to real execution paths.

---

## Why Multiple Specialist Agents?

A single general-purpose agent makes poor trade-offs across the full software lifecycle:

- **Security reviews** require deep adversarial thinking that competes with fast code-writing instincts.
- **Architecture decisions** require broad context that should not be mixed with narrow implementation tasks.
- **Release gates** must be pessimistic and human-confirming, not optimistic and automated.
- **Cost analysis** should observe without mutating, never removing dependencies on its own authority.

By separating concerns into specialist agents with explicit capability grants and tool boundaries, JackHammer can:

1. Apply the right reasoning posture to each task.
2. Enforce least-privilege tool access per role.
3. Require human approval only for the operations that genuinely need it.
4. Scale parallelism safely: high-risk roles run serialized (`maxParallelism: 1`); low-risk read-only roles can run in parallel.

---

## AgentCard: The Building Block

An `AgentCard` is a JSON-serializable descriptor for one specialist role. All fields are required.

```typescript
type AgentCard = {
  id: string;                             // Stable kebab-case identifier
  name: string;                           // Human-readable display name
  role: AgentRole;                        // Typed role discriminant
  responsibilities: readonly string[];    // What this agent is accountable for
  capabilities: readonly AgentCapability[]; // Functional skills this agent has
  allowedTools: readonly string[];        // Tools this agent may use
  deniedTools: readonly string[];         // Explicitly blocked tools
  readScopes: readonly string[];          // Data this agent may read
  writeScopes: readonly string[];         // Data this agent may write
  maxCostTier: AgentCostTier;             // Budget ceiling: low | medium | high | critical
  maxParallelism: number;                 // How many concurrent tasks allowed
  requiresHumanApprovalFor: readonly string[]; // Operations requiring human sign-off
  handoffTargets: readonly AgentRole[];   // Agents this role can delegate to
  safetyRules: readonly string[];         // Invariants that must never be violated
};
```

Every `AgentCard` can be validated at runtime with `validateAgentCard(card)`, which returns `{ valid: boolean; errors: string[] }`.

---

## Default Agent Registry

`createDefaultAgentRegistry()` returns the full set of 14 specialist agents:

| ID | Name | Key Capabilities |
|----|------|-----------------|
| `orchestrator` | Orchestrator | orchestration, multi-agent-coordination |
| `product-manager` | Product Manager | product-planning, documentation |
| `software-architect` | Software Architect | architecture-design, dependency-analysis |
| `multi-agent-systems-architect` | Multi-Agent Systems Architect | a2a-communication, mcp-tool-access |
| `minimal-change-engineer` | Minimal Change Engineer | minimal-change-implementation, dry-run-validation |
| `code-reviewer` | Code Reviewer | code-review, test-analysis |
| `security-architect` | Security Architect | security-review, architecture-design |
| `appsec-engineer` | AppSec Engineer | appsec-review, security-review |
| `qa-test-engineer` | QA Test Engineer | test-design, test-analysis |
| `test-results-analyzer` | Test Results Analyzer | test-analysis, cost-analysis |
| `devops-sre` | DevOps / SRE | devops-automation, dry-run-validation |
| `cost-optimizer` | Cost Optimizer | cost-analysis, dependency-analysis |
| `technical-writer` | Technical Writer | documentation, product-planning |
| `release-manager` | Release Manager | release-management, dry-run-validation |

---

## A2A-Inspired Agent-to-Agent Communication

JackHammer's delegation model is inspired by the [A2A (Agent-to-Agent) protocol](https://google.github.io/A2A/) concept: agents communicate via structured `AgentDelegationMessage` values rather than direct function calls or shared mutable state.

```typescript
type AgentDelegationMessage = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  topic: string;
  payload: Record<string, unknown>;       // JSON-serializable task context
  requiredCapabilities: readonly AgentCapability[];
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;                      // ISO-8601 timestamp
};
```

Use `createDelegationMessage(options)` to produce a delegation message. All fields are immutable — there is no shared state mutation between agents in this model.

**Current status:** Messages are pure data. A future PR will add a message router that dispatches them to real agent executors.

---

## MCP-Inspired Tool and Data Access Boundaries

Each `AgentCard` declares `allowedTools`, `deniedTools`, `readScopes`, and `writeScopes` — inspired by the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) concept of tool and resource boundaries.

Key principles:
- **Deny-by-default** for destructive tools: `secrets`, `auth-write`, `deploy`, `infra-write` appear in `deniedTools` for most agents.
- **Read is broader than write**: agents generally read more than they write to perform analysis without side effects.
- **Explicit write scopes**: no agent writes to `source-code` unless its role requires it (e.g., `minimal-change-engineer`).
- **Deny overrides allow**: if a tool appears in both `allowedTools` and `deniedTools`, denial wins.

**Current status:** Tool boundaries are declared as metadata. A future PR will enforce them in the execution router.

---

## Cost-Tier Escalation

Each `AgentCard` has a `maxCostTier` (`low | medium | high | critical`) representing the baseline compute/token budget for that role. The `estimateAgentCostTier(card, taskRisk)` function escalates the tier based on task risk:

| Agent maxCostTier | Task Risk | Estimated Tier |
|-------------------|-----------|----------------|
| low | low | low |
| low | critical | high |
| high | low | high |
| high | critical | critical (capped) |

The escalation is capped at `critical`. This is used to gate expensive operations behind human approval before they run.

The companion `AgentBudgetPolicy` type defines per-agent token limits, action caps, and `dryRunFirst` enforcement:

```typescript
type AgentBudgetPolicy = {
  agentId: string;
  maxCostTier: AgentCostTier;
  maxTokensPerTask?: number;
  maxActionsPerRun?: number;
  dryRunFirst: boolean;
  requiresApprovalAboveTier?: AgentCostTier;
};
```

**Current status:** Policy is a type. A future PR will enforce it in the execution runtime.

---

## Dry-Run-First Safety

Several agents have `dry-run-validation` in their capabilities (`minimal-change-engineer`, `devops-sre`, `qa-test-engineer`, `release-manager`). This signals that these agents should:

1. Produce a description of what they would do.
2. Wait for human confirmation (or automated gate approval).
3. Only then apply the change.

`AgentBudgetPolicy.dryRunFirst` makes this explicit per agent.

---

## Round-Table Planning

For complex decisions requiring multiple perspectives, `planRoundTable(registry, topic, requiredCapabilities, options)` selects a deduplicated participant list bounded by `maxParticipants`:

```typescript
const plan = planRoundTable(
  registry,
  'Security architecture review',
  ['security-review', 'appsec-review', 'architecture-design'],
  { maxParticipants: 4 }
);
// plan.participants: [security-architect, appsec-engineer, multi-agent-systems-architect, software-architect]
```

The returned `AgentRoundTablePlan` is a pure value — no agents are invoked. A future PR will add a round-table executor that dispatches `AgentDelegationMessage` values to each participant and collects `AgentArtifact` outputs.

---

## Artifacts and Decisions

Two additional types capture agent outputs:

**`AgentArtifact`** — a named, typed output produced by an agent:
```typescript
type AgentArtifact = {
  id: string;
  agentId: string;
  kind: 'analysis' | 'plan' | 'review' | 'decision' | 'report' | 'patch' | 'test-results';
  title: string;
  content: string;       // Markdown or JSON string
  createdAt: string;
  workItemId?: string;
};
```

**`AgentDecision`** — a structured approve/reject/defer/escalate response:
```typescript
type AgentDecision = {
  agentId: string;
  topic: string;
  decision: 'approve' | 'reject' | 'defer' | 'escalate';
  rationale: string;
  requiresHumanApproval: boolean;
  createdAt: string;
};
```

---

## Branch/Fork Execution Modes (Planned)

Future PRs will add branch-isolated and fork-isolated execution modes:

- **Branch mode**: agent work runs on a dedicated git branch, reviewed before merge.
- **Fork mode**: agent work runs in a throwaway worktree fork; only the diff is promoted.
- **Dry-run mode**: agent produces a plan artifact but does not write any files.

These modes will be declared on `AgentBudgetPolicy` and enforced by the execution router. No execution router exists in this PR.

---

## This PR: Model-Only

This PR adds `src/agents/` as a fully isolated, test-covered module with no production wires:

- **No imports from `src/index.ts`, `src/config.ts`, or any scheduling code.**
- **No runtime dependencies added.**
- **No agent executes code, calls APIs, or modifies files.**
- **All functions are synchronous pure functions returning plain objects.**
- **All types are JSON-serializable.**

The module can be imported by future PRs to drive real execution without any changes to the model layer.

### Files Added

| File | Purpose |
|------|---------|
| `src/agents/types.ts` | All type definitions |
| `src/agents/registry.ts` | Default agent registry and selection functions |
| `src/agents/delegation.ts` | Delegation messages and round-table planning |
| `src/agents/policy.ts` | Card validation and cost-tier estimation |
| `src/agents/agents.test.ts` | Test coverage for all pure functions |
| `docs/AGENT_OPERATING_MODEL.md` | This document |

---

## Next Steps

The recommended next PR after this one is to add **branch-isolated agent execution**: wire `selectAgentsForWorkItem` and `createDelegationMessage` into a preview-only execution path (behind `ADAPTIVE_QUEUE_ENABLED=true`) so that agent delegation messages are written to the existing event journal for inspection, with no production scheduling changes.
