# Idempotency Retention Policy

Date baseline: **July 25, 2026.**

## Result schema

Each idempotency record stores:
- idempotency_key
- conversation_id
- operation_name
- result_hash
- created_at
- expires_at
- replay_count

## TTL policy

- Default TTL: 30 days from `created_at`.
- High-risk operations MAY use 90-day TTL via explicit policy override.

## Compaction

- Daily compaction removes expired rows in bounded batches.
- Compaction must preserve audit counters and emit deletion metrics.
- Compaction must never remove unexpired records.

## Storage alarms

- Alert when table size > 80% planned capacity.
- Alert when compaction lag > 24h.
- Alert when expired row backlog > 1M rows.

