# Outbox Relay Contract

- **Date:** July 25, 2026

## Retry/backoff policy

1. Relay reads undispatched rows in bounded batches.
2. Failed dispatch retries with exponential backoff + jitter.
3. Base delay: 1s; multiplier: 2x; max delay cap: 300s.
4. Retry scheduling must be deterministic and observable.

## Poison-message handling

1. Max attempts: 12.
2. After max attempts, record is quarantined (DLQ/poison state).
3. Quarantine emits high-severity alert and requires explicit operator replay.
4. Quarantine metadata stores final error code/message hash/attempt count.

## Idempotent dispatch key

Dispatch dedupe key:

`{conversation_id}:{sequence_number}:{dispatch_type}`

Receivers must treat this key idempotently.

## Dispatch observability fields

Required fields per attempt:
1. `outbox_id`
2. `conversation_id`
3. `sequence_number`
4. `dispatch_type`
5. `dedupe_key`
6. `attempt_number`
7. `queue_lag_ms`
8. `attempt_duration_ms`
9. `result` (`success|retry|quarantine`)
10. `last_error_code`
11. `last_error_message_hash`

## Operational failure modes

1. **Transient downstream outage** -> retry/backoff, lag rises.
2. **Permanent payload incompatibility** -> quarantine after max attempts.
3. **Relay crash/restart** -> at-least-once retry on restart.
4. **Duplicate dispatch attempt** -> dedupe key prevents duplicate effect.
5. **Backlog saturation** -> alert on lag/failure thresholds; scale relay workers.

