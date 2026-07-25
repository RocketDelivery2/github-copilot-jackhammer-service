# Conversations Core Conformance Plan

- **Date:** July 25, 2026
- **Gate level:** MUST PASS for merge
- **Terminology:** exactly-once effect under at-least-once delivery

## Scenario map

| Scenario | Setup | Action | Expected result | Assertions | Telemetry to verify |
|---|---|---|---|---|---|
| Concurrent append conflict | Two workers load same conversation at version `N` | Both append with `expectedVersion=N` | Exactly one success; one conflict with `actualVersion=N+1` | Single row at sequence `N+1`; conflict response includes actualVersion | `append_attempts`, `append_success`, `append_conflicts` |
| Duplicate idempotency key | Same logical command delivered twice with same key | Execute handler twice | Exactly-once effect; second returns cached result | One provider call; one append effect; one idempotency row | `idempotency_hits`, `idempotency_misses`, `provider_calls`, `append_success` |
| Stale fencing token renew | Lease transferred to newer token | Renew old token | Renewal rejected | Stale renew returns null/error; current lease unchanged | `lease_renew_attempts`, `lease_renew_reject_stale` |
| Crash between artifact store and append | Artifact stored, append not committed | Retry same idempotency key command | Append completes using existing artifact, no provider re-call | Provider call count unchanged; artifact reference reused | `provider_calls`, `artifact_reuse`, `append_success` |
| Stale expectedVersion append | Current version > expectedVersion | Append with stale expectedVersion | Conflict always returned | No silent success; no overwrite | `append_conflicts`, sequence gap checks |
| Snapshot failure isolation | Append succeeds; snapshot write forced to fail | Run append + snapshot update | Append still successful | Event committed; snapshot failure isolated to projection path | `append_success`, `snapshot_failures`, projection lag |

## Negative tests (must pass)

1. Stale `expectedVersion` never silently succeeds.
2. Duplicate idempotency key never causes second provider/effect execution.
3. Expired/stale fencing token renewal never succeeds.
4. Snapshot failure never invalidates append success.

## Merge gate

This conformance suite is blocking. Any failure blocks merge until fixed and rerun.

