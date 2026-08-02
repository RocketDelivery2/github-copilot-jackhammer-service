# Automation Governance Notes

Date baseline: **July 26, 2026.**

These are the operations this repository intentionally keeps manual or gated.

## Intentionally not automated

- Repository and organization setting changes.
- Branch protection changes.
- Secret creation, rotation, and credential recovery.
- Bypassing required checks, review rules, or token permissions.
- Destructive production actions without explicit gating.
- Any behavior that would silently override a failed check or unsafe state.

## Gated automation only

- PR approval, merge, branch deletion, and issue closure only run when the explicit full-autopilot flags are enabled.
- Scheduled runs stay preview-first unless the environment is configured to permit mutation.
- Failed or ambiguous runs should stop and surface the blocker instead of guessing.

## Operational impact

- Safe defaults reduce accidental mutation, but they can leave scheduled runs idle when config is incomplete.
- Manual intervention is expected for permissions, branch protection, and secret issues.
- Documentation-only updates are the preferred place for policy clarification and runbook drift fixes.
