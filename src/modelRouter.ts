import type { AppConfig } from './config.js';

/**
 * Describes the kind of OpenAI inference call being made, plus any signals
 * used to determine the appropriate model tier.
 */
export type RoutingContext =
  | {
      call: 'task_creation';
      /**
       * True when the queue contains high-priority or architecturally complex work
       * (e.g. bug fixes, security tasks, multi-file features). Preserved for
       * future escalation within task_creation if cheaper generation is ever tried;
       * currently task_creation always uses the standard model.
       */
      hasComplexWork?: boolean;
    }
  | {
      call: 'continuation_comment';
    };

/** The resolved model tier for a given inference call. */
export type ModelTier = 'cheap' | 'standard';

/**
 * Explicit escalation criteria. These rules are the authoritative source
 * for routing decisions and are exported so tests and documentation can
 * reference them directly.
 */
export const ESCALATION_CRITERIA = {
  /**
   * Call kinds that always require the standard (full-capacity) model because
   * they involve broad multi-file repo reasoning and structured JSON generation.
   */
  alwaysStandardCalls: ['task_creation'] as const,

  /**
   * Call kinds that are always routed to the cheap model: short, bounded
   * text generation where reasoning depth has diminishing returns.
   */
  alwaysCheapCalls: ['continuation_comment'] as const,

  /**
   * Signal on task_creation that would force standard-model escalation if a
   * cheaper task_creation path were ever added. Currently unused since
   * task_creation is always standard, but declared here for forward-compatibility.
   */
  taskCreationEscalationSignal: 'hasComplexWork' as const,
} as const;

/**
 * Selects the model tier for a routing context.
 *
 * Rules (evaluated in order):
 *   1. continuation_comment → cheap (always: short bounded output, no deep reasoning)
 *   2. task_creation         → standard (always: full repo context + structured output)
 */
export function selectModelTier(ctx: RoutingContext): ModelTier {
  if (ctx.call === 'continuation_comment') {
    return 'cheap';
  }
  // task_creation: always standard — broad codebase analysis + strict JSON schema
  return 'standard';
}

/**
 * Resolves the concrete model name for an inference call.
 *
 * Behavior:
 *   - When MODEL_ROUTING_ENABLED=false (default): always returns OPENAI_MODEL.
 *     Existing behavior is preserved; no routing occurs.
 *   - When MODEL_ROUTING_ENABLED=true: routes cheap tier → OPENAI_CHEAP_MODEL,
 *     standard tier → OPENAI_MODEL.
 *   - Fallback: if OPENAI_CHEAP_MODEL is empty, falls back to OPENAI_MODEL so
 *     the service never calls the API with a blank model name.
 */
export function resolveModel(
  ctx: RoutingContext,
  cfg: Pick<AppConfig, 'OPENAI_MODEL' | 'OPENAI_CHEAP_MODEL' | 'MODEL_ROUTING_ENABLED'>,
): string {
  if (!cfg.MODEL_ROUTING_ENABLED) {
    return cfg.OPENAI_MODEL;
  }
  const tier = selectModelTier(ctx);
  if (tier === 'cheap') {
    return cfg.OPENAI_CHEAP_MODEL || cfg.OPENAI_MODEL;
  }
  return cfg.OPENAI_MODEL;
}
