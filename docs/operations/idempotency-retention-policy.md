# Idempotency Retention Policy

- **Date:** July 25, 2026

## Result schema

Each idempotency record stores:
1. `idempotency_key`
2. `result` (canonical JSON payload for exactly-once effect under at-least-once delivery)
3. `recorded_at`
4. Optional metadata: `provider`, `artifact_ref`, `status`

## TTL / retention window

Recommended baseline TTL: **60 days**.

Options:
1. 30 days: lower storage, less long-tail duplicate protection.
2. 60 days: balanced default.
3. 90 days: stronger duplicate protection, higher storage/index cost.

## Compaction strategy

1. Daily prune job deletes rows older than TTL.
2. Chunked deletes to avoid long locks.
3. Track prune duration, row count deleted, and index bloat.
4. Prune job is resumable and idempotent.

## Storage growth alarms

1. Warning at 70% of budgeted storage.
2. Critical at 90% of budgeted storage.
3. Alert on 2 consecutive prune-job failures.
4. Alert on abnormal growth slope beyond expected traffic profile.

