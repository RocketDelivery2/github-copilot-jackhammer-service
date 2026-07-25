-- Conversations Core Event Store DDL skeleton
-- Date: July 25, 2026
-- Spec-first migration scaffold only; runtime usage remains feature-gated/off by default.

CREATE TABLE IF NOT EXISTS conversation_events (
  conversation_id UUID NOT NULL,
  sequence_number BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Concurrency invariant:
  -- PK is the optimistic concurrency check; only one writer can claim a sequence.
  PRIMARY KEY (conversation_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  result JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Delivery invariant:
  -- One key -> one canonical effect result (exactly-once effect under at-least-once delivery).
);

CREATE SEQUENCE IF NOT EXISTS fencing_token_seq;
-- Lease safety invariant:
-- Monotonic token source to reject stale workers on side effects.

CREATE TABLE IF NOT EXISTS write_leases (
  resource_path TEXT PRIMARY KEY,
  lease_id UUID NOT NULL,
  holder_identity TEXT NOT NULL,
  fencing_token BIGINT NOT NULL DEFAULT nextval('fencing_token_seq'),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS event_outbox (
  outbox_id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  sequence_number BIGINT NOT NULL,
  dispatch_type TEXT NOT NULL,
  dispatch_payload JSONB NOT NULL,
  dispatched_at TIMESTAMPTZ,
  -- Atomicity invariant:
  -- Outbox row references committed event and is written in same transaction.
  CONSTRAINT fk_event_outbox_event
    FOREIGN KEY (conversation_id, sequence_number)
    REFERENCES conversation_events (conversation_id, sequence_number)
);

