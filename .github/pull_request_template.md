## Summary

-

## Validation

-

## Conversations Core Concurrency Gates

- [ ] concurrent append: exactly one success, one conflict(actualVersion)
- [ ] duplicate idempotency key: exactly-once effect under at-least-once delivery
- [ ] stale fencing token renew rejected
- [ ] crash between artifact store and append does not re-call provider
- [ ] stale expectedVersion never silently succeeds
- [ ] snapshot failure never invalidates append success

