/**
 * Specialist Agent Catalog — deterministic selector.
 *
 * Maps RepositorySignals to a stable, deduplicated subset of specialist agents.
 * Selection is purely functional: same inputs always produce the same output.
 * No agent is activated by default (feature flag defaults to false).
 */

import { SPECIALIST_CATALOG } from './catalog.js';
import type {
  RepositorySignals,
  SelectSpecialistsOptions,
  SpecialistAgentCard,
  SpecialistCapability,
  SpecialistSelectionResult,
} from './types.js';
import { DEFAULT_MAX_TEAM_SIZE, SPECIALIST_CAPABILITIES } from './types.js';

/**
 * Returns whether the given string is a known SpecialistCapability.
 * Rejects unknown capability strings.
 */
export function isKnownCapability(value: string): value is SpecialistCapability {
  return (SPECIALIST_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Validates a set of capability strings.
 * Returns an array of error messages (empty when all are valid).
 */
export function validateCapabilities(values: readonly string[]): string[] {
  return values
    .filter(v => !isKnownCapability(v))
    .map(v => `Unknown capability: "${v}"`);
}

/**
 * Deterministically selects specialist agents for a repository.
 *
 * Rules applied in order:
 *   1. If featureEnabled is false (default), returns empty selection immediately.
 *   2. Signals map to agent IDs via pure boolean predicates.
 *   3. Duplicates are removed by agent ID (preserving first occurrence).
 *   4. Agents are ordered by their stable index in the catalog array.
 *   5. maximumTeamSize is enforced by slicing after sorting.
 */
export function selectSpecialists(options: SelectSpecialistsOptions): SpecialistSelectionResult {
  const featureEnabled = options.featureEnabled ?? false;
  const maxTeamSize = options.maximumTeamSize ?? DEFAULT_MAX_TEAM_SIZE;

  if (!featureEnabled) {
    return { selected: [], featureEnabled: false, teamSize: 0 };
  }

  const signals = options.signals;
  const selectedIds = new Set<string>();

  // Chief Orchestrator — always present when the catalog is active.
  selectedIds.add('chief-orchestrator');

  // Requirements Architect — always present when feature is enabled.
  selectedIds.add('requirements-architect');

  // Software Architect — when any primary programming language is detected.
  if (hasSourceCode(signals)) {
    selectedIds.add('software-architect');
  }

  // Security Architect — always present (security review is always relevant).
  selectedIds.add('security-architect');

  // QA Architect — when the repository has tests.
  if (signals.hasTests) {
    selectedIds.add('qa-architect');
  }

  // Implementation Engineer — only when CI is configured (validates output)
  // and is an execution agent (requires separate approval token).
  if (signals.hasCI) {
    selectedIds.add('implementation-engineer');
  }

  // Performance Engineer — when performance tests or profiling config exists.
  if (signals.hasPerformanceTests) {
    selectedIds.add('performance-engineer');
  }

  // Database Engineer — when schema or migration files are present.
  if (signals.hasDatabase || signals.hasMigrationFiles) {
    selectedIds.add('database-engineer');
  }

  // API Integration Architect — when API definitions or API code exists.
  if (signals.hasAPI || signals.hasOpenAPIDef) {
    selectedIds.add('api-integration-architect');
  }

  // DevOps / SRE — when CI, Docker, Kubernetes, or Terraform is present.
  if (signals.hasCI || signals.hasDocker || signals.hasKubernetes || signals.hasTerraform) {
    selectedIds.add('devops-sre');
  }

  // Observability Engineer — when monitoring configuration is present.
  if (signals.hasObservabilityConfig) {
    selectedIds.add('observability-engineer');
  }

  // Accessibility Engineer — when accessibility requirements are defined.
  if (signals.hasAccessibilityRequirements) {
    selectedIds.add('accessibility-engineer');
  }

  // Dependency & Supply-Chain Reviewer — when a lockfile is present.
  if (signals.hasDependencyLockfile) {
    selectedIds.add('dependency-supply-chain-reviewer');
  }

  // Incident Forensics Reviewer — only when recent incidents are detected.
  if (signals.hasRecentIncidents) {
    selectedIds.add('incident-forensics-reviewer');
  }

  // Documentation Engineer — when a docs folder exists or the repo is a library.
  if (signals.hasDocsFolder || signals.isLibrary) {
    selectedIds.add('documentation-engineer');
  }

  // Release Governor — when a release workflow is configured.
  if (signals.hasReleaseWorkflow) {
    selectedIds.add('release-governor');
  }

  // Resolve IDs to cards in catalog order (stable, deterministic).
  const catalogIndex = new Map<string, number>(
    SPECIALIST_CATALOG.map((card, i) => [card.id, i]),
  );

  const resolved: SpecialistAgentCard[] = [];
  for (const id of selectedIds) {
    const card = SPECIALIST_CATALOG.find(c => c.id === id);
    if (card !== undefined) {
      resolved.push(card);
    }
  }

  // Sort by catalog order for stable output.
  resolved.sort((a, b) => {
    const ia = catalogIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const ib = catalogIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });

  // Enforce maximum team size.
  const capped = resolved.slice(0, maxTeamSize);

  return {
    selected: capped,
    featureEnabled: true,
    teamSize: capped.length,
  };
}

function hasSourceCode(signals: RepositorySignals): boolean {
  return (
    signals.hasTypeScript ||
    signals.hasJavaScript ||
    signals.hasPython ||
    signals.hasGo ||
    signals.hasRust ||
    signals.hasJava
  );
}
