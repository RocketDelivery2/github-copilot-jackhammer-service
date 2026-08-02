/**
 * Test fixture: small TypeScript repository signals.
 *
 * Represents a typical small open-source TypeScript library: TypeScript source,
 * a test suite, CI workflow, documentation folder, and a dependency lockfile.
 * No database, no Docker, no accessibility requirements, no incidents.
 *
 * Use this fixture in tests that need a realistic but minimal repository signal set.
 */

import type { RepositorySignals } from '../types.js';

export const SMALL_TYPESCRIPT_REPO_SIGNALS: RepositorySignals = {
  hasTypeScript: true,
  hasJavaScript: false,
  hasPython: false,
  hasGo: false,
  hasRust: false,
  hasJava: false,
  hasTests: true,
  hasDatabase: false,
  hasAPI: false,
  hasCI: true,
  hasDocker: false,
  hasKubernetes: false,
  hasTerraform: false,
  hasAccessibilityRequirements: false,
  hasSecurityConfig: false,
  hasDocsFolder: true,
  hasDependencyLockfile: true,
  hasRecentIncidents: false,
  hasOpenAPIDef: false,
  hasMigrationFiles: false,
  hasPerformanceTests: false,
  hasObservabilityConfig: false,
  hasReleaseWorkflow: false,
  isLibrary: true,
};
