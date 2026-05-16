# Industry Standards Brain

The Industry Standards Brain ensures JackHammer ranks candidate Copilot commands using corporate-grade software engineering priorities before queueing work.

## Standards evaluated

JackHammer evaluates each candidate command across these dimensions:

- Correctness
- Build stability
- Test coverage
- Linting and formatting
- Security
- Maintainability
- Architecture fit
- Design patterns
- Object-oriented principles where relevant
- SOLID principles where relevant
- Dependency boundaries
- API contract stability
- Data integrity
- Validation and error handling
- Performance and algorithmic efficiency
- Big-O implications
- Observability
- CI/CD reliability
- Documentation
- Deployment readiness
- Frontend accessibility and UX
- Operational safety
- Rollback safety
- Least-risk incremental delivery

## Ranking model

The model computes a weighted standards score for every command and then rebalances the queue so that blockers and risk-reduction work are prioritized first.

High-impact boosts include:

- Build/test/lint failure resolution
- Security hardening and validation gaps
- API contract stability and compatibility
- Small, scoped, reviewable PR intent
- Clear test and validation steps

Penalties include:

- Broad vague refactors
- Large unvalidated rewrites
- Branch-spam instructions
- Missing tests or weak validation plans
- Instructions that bypass checks
- Secret-handling anti-patterns
- Workflow/CodeQL/labels/deployment/auth changes unless explicitly requested

## Balance of speed, quality, safety, and architecture

The queue optimizer favors commands that can ship quickly *and* safely. It scores work higher when it is:

- Incremental and reversible
- Tested and measurable
- Architecture-aligned
- Low-risk for production operations

This keeps throughput high without sacrificing build health, code quality, or operational safety.

## Why small validated PRs are preferred

Small validated PRs reduce review latency, simplify rollback, and reduce integration risk. The standards model rewards work that is narrow in scope and provides explicit verification steps.

## Backend-first and frontend-scale sequencing

When backend instability signals are detected, JackHammer penalizes frontend-only scale or polish work and elevates backend/API/domain stabilization first.

After backend foundations are stable, frontend UX/accessibility work naturally scores higher and moves up in the queue.
