# Outbox Relay Contract

Date baseline: **July 25, 2026.**

## Retry and backoff

- Strategy: exponential backoff with jitter.
- Base delay: 1s; max delay: 5m.
- Retry cap: 20 attempts before poison quarantine.

## Poison handling

- Rows that exceed retry cap move to `poison` state.
- Poison rows require operator triage with immutable error history.
- Requeue must preserve original dispatch key.

## Idempotent dispatch key

- Dispatch key format: `<conversation_id>:<sequence_no>:<event_type>`.
- Duplicate dispatch key processing must be side-effect free.

## Observability fields

Required on each relay attempt:
- outbox_id
- dispatch_key
- attempt_count
- next_attempt_at
- last_error
- relay_worker_id
- observed_latency_ms

## Failure modes

1. Relay crash before ack persist -> redelivery allowed; idempotent key prevents duplicate effect.
2. Provider timeout -> retry with backoff.
3. Provider permanent validation error -> poison path.
4. Database transient failure on status update -> retry write with same dispatch key context.

