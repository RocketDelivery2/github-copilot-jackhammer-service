-- Conversations Core event-store foundation
-- Date baseline: July 25, 2026.
-- Concurrency invariants:
-- 1) conversation_events is append-only.
-- 2) idempotency_records enforces one effect per idempotency scope.
-- 3) fencing_token_seq provides monotonic fencing tokens for lease arbitration.
-- 4) write_leases tracks active writer authority windows.
-- 5) event_outbox rows are causally tied to committed conversation_events rows.

CREATE TABLE IF NOT EXISTS conversation_events (
  event_id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sequence_no BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  operation_name TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (conversation_id, operation_name, idempotency_key)
);

CREATE SEQUENCE IF NOT EXISTS fencing_token_seq
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

CREATE TABLE IF NOT EXISTS write_leases (
  lease_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  fencing_token BIGINT NOT NULL DEFAULT nextval('fencing_token_seq'),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ NULL,
  UNIQUE (conversation_id, fencing_token)
);

CREATE TABLE IF NOT EXISTS event_outbox (
  outbox_id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES conversation_events(event_id) ON DELETE CASCADE,
  dispatch_key TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ NULL
);

