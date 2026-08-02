# Specialist Agent Catalog — Internal Documentation

> **Internal demo codename: Autobots**
> This name must NOT appear in public APIs, exported schemas, package names, or public documentation.
> It may appear only in the `internalThemeAlias` field of `SpecialistAgentCard`.

## What this is

The Specialist Agent Catalog is a new subsystem in JackHammer that maintains a curated set of
read-only-by-default agent role definitions. A deterministic selector maps repository signals to a
bounded subset of active roles for a given task.

**The 16 roles in this catalog are a representative sample** of a planned larger catalog — they are
not 16 autonomous human equivalents or 16 fully operational bots. Each role is a narrowly scoped
specification that constrains what an AI provider session may observe, produce, and do.

## Architecture

```
RepositorySignals
      │
      ▼
selectSpecialists()          ← feature flag guarded, default off
      │
      ├─ maps signals → role IDs (pure, deterministic)
      ├─ deduplicates by agent ID
      ├─ sorts by stable catalog order
      └─ caps at maximumTeamSize (default 8)
      │
      ▼
SpecialistSelectionResult
  { selected[], featureEnabled, teamSize }
```

## Files

| Path | Purpose |
|------|---------|
| `src/agents/specialist-catalog/types.ts` | Type definitions (SpecialistAgentCard, AuthorityCeiling, RepositorySignals, …) |
| `src/agents/specialist-catalog/catalog.ts` | The 16 sample agent definitions |
| `src/agents/specialist-catalog/selector.ts` | Deterministic selector: signals → roles |
| `src/agents/specialist-catalog/index.ts` | Public exports |
| `src/agents/specialist-catalog/specialist-catalog.test.ts` | Test suite (8 behavioral areas) |
| `src/agents/specialist-catalog/fixtures/typescript-repo.fixture.ts` | Fixture: small TypeScript repository |

## The 16 sample roles

| # | ID | Risk Tier | Execution? |
|---|----|-----------|------------|
| 1 | `chief-orchestrator` | low | read-only |
| 2 | `requirements-architect` | low | read-only |
| 3 | `software-architect` | low | read-only |
| 4 | `security-architect` | medium | read-only |
| 5 | `qa-architect` | low | read-only |
| 6 | `implementation-engineer` | **high** | **execution** (approval token required) |
| 7 | `performance-engineer` | low | read-only |
| 8 | `database-engineer` | medium | read-only |
| 9 | `api-integration-architect` | low | read-only |
| 10 | `devops-sre` | medium | read-only |
| 11 | `observability-engineer` | low | read-only |
| 12 | `accessibility-engineer` | low | read-only |
| 13 | `dependency-supply-chain-reviewer` | low | read-only |
| 14 | `incident-forensics-reviewer` | medium | read-only |
| 15 | `documentation-engineer` | low | read-only |
| 16 | `release-governor` | **critical** | **execution** (approval token required) |

## Hard policy constraints

Every agent in this catalog is permanently subject to these constraints, enforced structurally
in `AuthorityCeiling`:

- **canMerge: false** — no agent may merge a pull request
- **canAdminRepo: false** — no agent may administer a repository
- **canAccessSecrets: false** — no agent may read secrets or credentials
- **requiresApprovalToken: true** for any agent with `canWrite: true` — execution agents
  require an out-of-band human approval token before any write or execute action runs

## Feature flag

The catalog selector is disabled by default. Passing `featureEnabled: false` (the default)
to `selectSpecialists()` returns an empty selection immediately. This ensures the catalog
has no effect on production scheduling until explicitly enabled.

```typescript
// Disabled (default) — no agents selected
const result = selectSpecialists({ signals });

// Enabled — deterministic selection runs
const result = selectSpecialists({ signals, featureEnabled: true });
```

## Selector activation rules

Roles are activated when specific repository signals are true:

| Role | Activation signal |
|------|-------------------|
| chief-orchestrator | always (when feature enabled) |
| requirements-architect | always (when feature enabled) |
| software-architect | any primary language detected |
| security-architect | always (when feature enabled) |
| qa-architect | `hasTests` |
| implementation-engineer | `hasCI` + approval token required |
| performance-engineer | `hasPerformanceTests` |
| database-engineer | `hasDatabase` or `hasMigrationFiles` |
| api-integration-architect | `hasAPI` or `hasOpenAPIDef` |
| devops-sre | `hasCI` or `hasDocker` or `hasKubernetes` or `hasTerraform` |
| observability-engineer | `hasObservabilityConfig` |
| accessibility-engineer | `hasAccessibilityRequirements` |
| dependency-supply-chain-reviewer | `hasDependencyLockfile` |
| incident-forensics-reviewer | `hasRecentIncidents` |
| documentation-engineer | `hasDocsFolder` or `isLibrary` |
| release-governor | `hasReleaseWorkflow` |

## Relationship to existing agent registry

The specialist catalog (`src/agents/specialist-catalog/`) is **separate** from the existing
agent registry (`src/agents/registry.ts`). The two systems use different schemas and serve
different purposes:

- **Existing registry** (`AgentCard`): Lightweight agent routing for JackHammer's internal
  orchestration. Used by `selectAgentsForWorkItem`, `planRoundTable`, and `createDelegationMessage`.

- **Specialist catalog** (`SpecialistAgentCard`): Richer, policy-enforcing definitions designed
  for external AI provider sessions. Includes authority ceilings, budget limits, evidence
  requirements, and activation conditions that the existing registry does not capture.

Neither system affects the other's runtime behavior. The specialist catalog is entirely
preview/disabled by default.

## Adding more roles

The catalog is designed to grow beyond 16. To add a new role:

1. Add a new `SpecialistAgentCard` entry to `SPECIALIST_CATALOG` in `catalog.ts`.
2. Add an activation predicate in `selectSpecialists()` in `selector.ts`.
3. Add coverage in `specialist-catalog.test.ts`.
4. Update this document.

Do not change the `REQUIRED_AGENT_IDS` list in the existing `agents.test.ts` — that test
covers the separate existing registry, which is unrelated to the specialist catalog.
