# Conversations Core Event Store Concurrency Spec

Date baseline: **July 25, 2026.**

This design targets **exactly-once effect under at-least-once delivery.**

## Invariants

1. Each domain write is recorded first as an immutable event row.
2. Idempotency keys are unique per effect scope and block duplicate effects.
3. Lease and fencing tokens gate concurrent writers.
4. Outbox dispatch is derived from committed event rows only.

## Provider-call-outside-transaction rule

All external provider calls must occur outside the database transaction that persists `conversation_events` and `event_outbox` rows. Transactions must only contain deterministic local state mutation.

## Idempotency and fencing-token boundaries

- Idempotency key boundary: `(conversation_id, operation_name, idempotency_key)`.
- Fencing token boundary: monotonic token from `fencing_token_seq` per lease holder.
- Any stale token write attempt is rejected before effect publication.

## Crash-boundary recovery matrix

| Boundary | Failure point | Recovery action |
|---|---|---|
| Before event insert | Process exits before commit | Safe retry with same idempotency key |
| After event commit, before outbox commit | Transaction rollback | Safe retry; no committed effect |
| After event+outbox commit, before relay send | Process exits | Relay resumes from undispatched outbox rows |
| After relay send, before ack persist | Process exits | Redelivery allowed; idempotent dispatch key suppresses duplicate effect |

## Multi-region home-region pinning

Writes are pinned to a conversation home region. Read replicas may be regional, but writes and idempotency enforcement are authoritative in home region only.

## Explicit non-goals

- no cross-region multi-master writes

