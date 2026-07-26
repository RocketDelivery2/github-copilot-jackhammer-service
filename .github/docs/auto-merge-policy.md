# Auto-approve and auto-merge policy

## Scope

This repository uses three workflows for low-risk PR automation:

1. `.github/workflows/auto-merge.yml`
2. `.github/workflows/dependabot-auto-approve.yml`
3. `.github/workflows/dependabot-auto-merge.yml`

Automation is deterministic and fail-closed. If any required gate fails, no new approval or auto-merge arming occurs.

## Trigger model

### `auto-merge.yml`

- `pull_request` on `main` for: `opened`, `synchronize`, `reopened`, `ready_for_review`, `labeled`, `unlabeled`
- `create` for branch creation (opens a draft PR to `main` when one does not already exist)

### Dependabot workflows

- `pull_request_target` for: `opened`, `synchronize`, `reopened`, `labeled`, `unlabeled`, `ready_for_review`

## Shared deny labels

All workflows hard-block when any of these labels are present:

- `security`
- `breaking-change`
- `do-not-merge`
- `no-auto-merge`

## `auto-merge.yml` gates (all must pass)

| Gate | Requirement |
|---|---|
| Repository match | Workflow must execute in `RocketDelivery2/github-copilot-jackhammer-service` |
| Open/ready state | PR must be `OPEN` and not draft |
| Base branch scope | Base branch must be `main` |
| Head branch scope | Head branch must match one of: `dependabot/*`, `automation/*`, `autofix/*`, `chore/*`, `docs/*` |
| Actor and trust | PR author must be `dependabot[bot]`, or actor/author must be trusted (`OWNER`, `MEMBER`, `COLLABORATOR`) with actor in trusted set (`github-actions[bot]`, `dependabot[bot]`, `renovate[bot]`) or actor equal to PR author |
| Low-risk signal | PR must include one of `auto-merge`, `low-risk`, `dependencies`, `chore`, `documentation` labels, or be authored by `dependabot[bot]` |
| Deny labels | None of the deny labels may be present |

If gates pass, the workflow performs idempotent actions:

- approve only when `github-actions[bot]` has not already approved
- arm auto-merge only when auto-merge is not already armed

## Dependabot workflows gates (all must pass)

Both dependabot workflows require:

| Gate | Requirement |
|---|---|
| Repository match | Workflow must execute in `RocketDelivery2/github-copilot-jackhammer-service` |
| Open/ready state | PR must be `OPEN` and not draft |
| Actor check | PR author must be `dependabot[bot]` |
| Branch scope | Head branch must match `dependabot/*` |
| Deny labels | None of the deny labels may be present |

Idempotency behavior:

- `dependabot-auto-approve.yml`: no-op when `github-actions[bot]` approval already exists
- `dependabot-auto-merge.yml`: no-op when auto-merge is already armed

## Audit output

Every run writes an explicit policy table to `GITHUB_STEP_SUMMARY` including:

- each gate name
- PASS/BLOCKED result
- deterministic reason text
- final decision (`ALLOW`, `BLOCK`, or `NOOP`)
- idempotency note explaining skipped duplicate operations when applicable

## Operational notes

- Workflow automation does not bypass branch protection, required checks, required reviews, or repository/org policy.
- Emergency disable remains available with GitHub Actions workflow disable.
