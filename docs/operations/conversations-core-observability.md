# Conversations Core Observability

Date baseline: **July 25, 2026.**

## Required metrics

- `conversation_events_append_latency_ms`
- `idempotency_lookup_latency_ms`
- `write_lease_acquire_latency_ms`
- `outbox_dispatch_latency_ms`
- `outbox_retry_count`
- `outbox_poison_count`
- `checkpoint_recovery_duration_ms`
- `stale_state_detection_count`

## Latency targets

| Metric | Target |
|---|---|
| conversation_events_append_latency_ms | proposed until benchmarked. |
| idempotency_lookup_latency_ms | proposed until benchmarked. |
| write_lease_acquire_latency_ms | proposed until benchmarked. |
| outbox_dispatch_latency_ms | proposed until benchmarked. |
| checkpoint_recovery_duration_ms | proposed until benchmarked. |

## Reliability signals

- Event append success rate
- Idempotency hit ratio
- Lease contention rate
- Outbox poison rate
- Rejoin success rate

