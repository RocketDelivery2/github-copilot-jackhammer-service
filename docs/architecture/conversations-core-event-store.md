# Conversations Core — Event Store Concurrency & Performance ADR

- **Status:** Proposed
- **Date:** July 25, 2026

## Context

Conversations Core needs deterministic write concurrency, recoverable side effects, and durable event history without changing runtime behavior in this PR.

## Decision

Adopt an event-store model where append correctness is enforced by SQL constraints and side effects are relayed asynchronously.

## Invariants

1. **Event log is source of truth**  
   `conversation_events` is authoritative. Snapshots/projections are rebuildable caches.
2. **PK-based optimistic concurrency**  
   `PRIMARY KEY (conversation_id, sequence_number)` is the append conflict mechanism.
3. **Outbox atomicity**  
   Event append rows and `event_outbox` rows are committed in one transaction.
4. **Provider call outside transaction**  
   Provider invocation occurs before append transaction begins.
5. **Exactly-once effect under at-least-once delivery**  
   Idempotency records prevent duplicate provider/effect outcomes even when command delivery retries.

## Idempotency and fencing-token boundaries

### Idempotency responsibilities

1. Check idempotency key before provider call.
2. Persist canonical result keyed by idempotency key.
3. Return cached result for duplicate deliveries.

### Fencing responsibilities

1. Lease ownership includes monotonic fencing token.
2. Side effects require current token validity.
3. Stale workers cannot renew/continue side effects after lease loss.

### Boundary

PK concurrency prevents conflicting append commits.  
Fencing tokens prevent stale-owner side effects.  
Both are required and solve different failure classes.

## Crash-boundary recovery matrix

| Crash boundary | Durable state | Recovery action |
|---|---|---|
| Before provider call | None | Re-run command path |
| After provider call, before artifact persistence | None | Re-call provider on retry |
| After artifact persistence, before append commit | Artifact durable, no event link | Reuse artifact via idempotency result and append without provider re-call |
| After append commit, before projection update | Event + outbox durable | Projection catches up; append remains successful |
| During outbox dispatch | Event durable; outbox pending | Retry with dedupe key until success or quarantine |

## Multi-region model

Each conversation is pinned to a home region at creation.  
All writes for that conversation occur in home region only.  
Cross-region replication is for read/DR, not multi-writer consistency.

## Non-goals

1. Cross-region multi-master writes for a single conversation.
2. Exactly-once transport delivery guarantees.
3. Making snapshots part of append transactional correctness.
4. Provider output determinism guarantees.

## Consequences

### Positive

1. Deterministic conflict handling under contention.
2. Recoverable side-effect pipeline via outbox.
3. Clear operational separation between correctness and performance caching.

### Tradeoffs

1. Hot conversations may see conflict/retry churn.
2. Provider non-idempotent APIs can still produce response variance across retries.

