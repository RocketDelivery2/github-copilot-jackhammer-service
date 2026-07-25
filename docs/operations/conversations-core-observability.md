# Conversations Core Observability and SLO Draft

- **Date:** July 25, 2026
- **Note:** All latency values are **proposed until benchmarked**.

## Required metrics

1. **Append latency p50/p95**
   - Metric: `conversation_append_latency_ms`
   - Labels: `environment`, `region`, `result`

2. **Append conflict rate**
   - Metrics: `append_conflicts_total`, `append_attempts_total`
   - Derived: `append_conflict_rate = conflicts/attempts`

3. **Idempotency hit ratio**
   - Metrics: `idempotency_hits_total`, `idempotency_lookups_total`
   - Derived: `idempotency_hit_ratio = hits/lookups`

4. **Stale-fencing rejection count**
   - Metric: `lease_renew_reject_stale_total`
   - Labels: `environment`, `resource_type`

5. **Outbox lag/failure rate**
   - Lag metric: `outbox_dispatch_lag_ms` (p50/p95/p99)
   - Failure metrics: `outbox_dispatch_failures_total`, `outbox_dispatch_attempts_total`
   - Derived: `outbox_dispatch_failure_rate = failures/attempts`

## Proposed alert thresholds (until benchmarked)

1. Append latency p95 above target for 15 minutes.
2. Conflict rate above baseline tolerance for 10 minutes.
3. Idempotency hit ratio anomaly (sudden sustained spike/drop).
4. Stale-fencing rejection spike above background baseline.
5. Outbox lag p95 breach for 10 minutes.
6. Outbox failure rate breach for 10 minutes.

## Dashboard sections

1. Write-path health (append attempts/success/conflicts/errors + p50/p95 latency)
2. Idempotency behavior (hits/misses/ratio trend)
3. Lease/fencing safety (stale rejection trend)
4. Outbox delivery (lag, attempts, failures, quarantine count)
5. SLO summary (current status + last 24h incidents)

