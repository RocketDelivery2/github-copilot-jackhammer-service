# Conversations Core Conformance Plan

Date baseline: **July 25, 2026.**

## MUST-PASS acceptance tests

1. Event append preserves strict monotonic sequence per conversation.
2. Duplicate idempotency key returns prior result without re-emitting effect.
3. Lease acquisition and fencing token monotonicity prevent stale writer commits.
4. Outbox row is created in same commit scope as `conversation_events`.
5. Replay of already-processed dispatch key is side-effect free.
6. Checkpoint recovery reconstructs state from event stream with no divergence.

## Negative tests (MUST-PASS)

1. Reject write attempts with expired lease.
2. Reject write attempts with non-current fencing token.
3. Reject outbox dispatch records missing idempotent dispatch key.
4. Reject malformed checkpoint payload/hash mismatch.
5. Reject stale repository state packet for write-intent paths.
6. Reject unauthorized mutation flag escalation in advisory conversation flows.

