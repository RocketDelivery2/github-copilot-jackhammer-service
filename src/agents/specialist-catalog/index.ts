/**
 * Specialist Agent Catalog — public API.
 *
 * Exports types, the 16-agent sample catalog, and the deterministic selector.
 * The internal "Autobots" demo codename must NOT be re-exported or exposed here.
 */

export type {
  AuthorityCeiling,
  RepositorySignals,
  SelectSpecialistsOptions,
  SpecialistAgentCard,
  SpecialistCapability,
  SpecialistRiskTier,
  SpecialistSelectionResult,
} from './types.js';

export { DEFAULT_MAX_TEAM_SIZE, SPECIALIST_CAPABILITIES } from './types.js';
export { SPECIALIST_CATALOG } from './catalog.js';
export { isKnownCapability, selectSpecialists, validateCapabilities } from './selector.js';
