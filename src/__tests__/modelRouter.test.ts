import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  selectModelTier,
  resolveModel,
  ESCALATION_CRITERIA,
  type RoutingContext,
} from '../modelRouter.js';

describe('ESCALATION_CRITERIA', () => {
  it('lists task_creation as always-standard', () => {
    assert.ok(
      (ESCALATION_CRITERIA.alwaysStandardCalls as readonly string[]).includes('task_creation'),
      'task_creation must be in alwaysStandardCalls',
    );
  });

  it('lists continuation_comment as always-cheap', () => {
    assert.ok(
      (ESCALATION_CRITERIA.alwaysCheapCalls as readonly string[]).includes('continuation_comment'),
      'continuation_comment must be in alwaysCheapCalls',
    );
  });

  it('escalation signal key is hasComplexWork', () => {
    assert.equal(ESCALATION_CRITERIA.taskCreationEscalationSignal, 'hasComplexWork');
  });
});

describe('selectModelTier', () => {
  it('routes continuation_comment to cheap tier', () => {
    const ctx: RoutingContext = { call: 'continuation_comment' };
    assert.equal(selectModelTier(ctx), 'cheap');
  });

  it('routes task_creation to standard tier', () => {
    const ctx: RoutingContext = { call: 'task_creation' };
    assert.equal(selectModelTier(ctx), 'standard');
  });

  it('routes task_creation with hasComplexWork=true to standard tier (escalation)', () => {
    const ctx: RoutingContext = { call: 'task_creation', hasComplexWork: true };
    assert.equal(selectModelTier(ctx), 'standard');
  });

  it('routes task_creation with hasComplexWork=false to standard tier', () => {
    const ctx: RoutingContext = { call: 'task_creation', hasComplexWork: false };
    assert.equal(selectModelTier(ctx), 'standard');
  });

  it('routes task_creation with hasComplexWork=undefined to standard tier', () => {
    const ctx: RoutingContext = { call: 'task_creation', hasComplexWork: undefined };
    assert.equal(selectModelTier(ctx), 'standard');
  });
});

describe('resolveModel — routing disabled (default)', () => {
  const baseCfg = {
    OPENAI_MODEL: 'gpt-5.5',
    OPENAI_CHEAP_MODEL: 'gpt-4.1-mini',
    MODEL_ROUTING_ENABLED: false,
  };

  it('returns OPENAI_MODEL for continuation_comment when routing disabled', () => {
    const ctx: RoutingContext = { call: 'continuation_comment' };
    assert.equal(resolveModel(ctx, baseCfg), 'gpt-5.5');
  });

  it('returns OPENAI_MODEL for task_creation when routing disabled', () => {
    const ctx: RoutingContext = { call: 'task_creation' };
    assert.equal(resolveModel(ctx, baseCfg), 'gpt-5.5');
  });

  it('ignores OPENAI_CHEAP_MODEL entirely when routing disabled', () => {
    const cfg = { ...baseCfg, OPENAI_CHEAP_MODEL: 'some-other-model' };
    const ctx: RoutingContext = { call: 'continuation_comment' };
    assert.equal(resolveModel(ctx, cfg), 'gpt-5.5');
  });
});

describe('resolveModel — routing enabled', () => {
  const routingCfg = {
    OPENAI_MODEL: 'gpt-5.5',
    OPENAI_CHEAP_MODEL: 'gpt-4.1-mini',
    MODEL_ROUTING_ENABLED: true,
  };

  it('returns OPENAI_CHEAP_MODEL for continuation_comment', () => {
    const ctx: RoutingContext = { call: 'continuation_comment' };
    assert.equal(resolveModel(ctx, routingCfg), 'gpt-4.1-mini');
  });

  it('returns OPENAI_MODEL for task_creation', () => {
    const ctx: RoutingContext = { call: 'task_creation' };
    assert.equal(resolveModel(ctx, routingCfg), 'gpt-5.5');
  });

  it('returns OPENAI_MODEL for task_creation even with hasComplexWork=true', () => {
    const ctx: RoutingContext = { call: 'task_creation', hasComplexWork: true };
    assert.equal(resolveModel(ctx, routingCfg), 'gpt-5.5');
  });
});

describe('resolveModel — fallback behavior', () => {
  it('falls back to OPENAI_MODEL when OPENAI_CHEAP_MODEL is empty string', () => {
    const cfg = {
      OPENAI_MODEL: 'gpt-5.5',
      OPENAI_CHEAP_MODEL: '',
      MODEL_ROUTING_ENABLED: true,
    };
    const ctx: RoutingContext = { call: 'continuation_comment' };
    assert.equal(
      resolveModel(ctx, cfg),
      'gpt-5.5',
      'must fall back to OPENAI_MODEL when cheap model is not configured',
    );
  });

  it('uses custom cheap model when provided', () => {
    const cfg = {
      OPENAI_MODEL: 'gpt-5.5',
      OPENAI_CHEAP_MODEL: 'gpt-4o-mini',
      MODEL_ROUTING_ENABLED: true,
    };
    const ctx: RoutingContext = { call: 'continuation_comment' };
    assert.equal(resolveModel(ctx, cfg), 'gpt-4o-mini');
  });
});
