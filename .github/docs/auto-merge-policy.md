# Auto-approve and auto-merge policy

## Scope

The `auto-merge.yml` workflow only arms squash auto-merge for approved bot-authored PRs.
Human-authored PRs are always blocked, even if they carry the `auto-merge` label.
`dependabot-auto-merge.yml` handles Dependabot separately with the same merge-readiness
checks.
This repository uses three workflows for low-risk PR automation:

1. `.github/workflows/auto-merge.yml`
2. `.github/workflows/dependabot-auto-approve.yml`
3. `.github/workflows/dependabot-auto-merge.yml`

The `auto-merge.yml` workflow only arms squash auto-merge for approved bot-authored PRs.
Human-authored PRs are always blocked, even if they carry the `auto-merge` label.
`dependabot-auto-merge.yml` handles Dependabot separately with the same merge-readiness
checks.

| # | Gate | Condition | Block behavior |
|---|------|-----------|----------------|
| 1 | Bot author | PR author must be an approved bot | Blocked; human-authored PRs are never auto-merged |
| 2 | Policy label | Bot PRs must carry the `auto-merge` label | Blocked; add the label only for approved bot PRs |
| 3 | Draft check | PR must not be in draft state | Blocked until marked ready for review |
| 4 | Policy labels | PR must NOT have `security`, `breaking-change`, or `do-not-merge` label | Blocked unconditionally; requires human merge |
| 5 | Review gate | Required review must be approved | Blocked until the review decision is `APPROVED` |
| 6 | Check gate | Required checks must be clean | Blocked until merge state is `CLEAN` |

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

| Scenario | Before (unsafe) | After (hardened) |
|----------|-----------------|-----------------|
| New branch pushed | Opens non-draft PR, arms merge immediately | Opens **draft** PR; no merge armed |
| Human PR with `auto-merge` label | Auto-approves + arms squash merge | Gate 1 blocks; merge NOT armed |
| Bot PR without `auto-merge` label | Arms merge | Gate 2 blocks; merge NOT armed |
| Bot PR with `auto-merge` label, not draft | Arms merge | All gates evaluated; arms only if checks/reviews are green |
| Draft bot PR with `auto-merge` label | Arms merge | Gate 3 blocks; merge NOT armed |
| PR with `security` label | Arms merge | Gate 4 blocks; merge NOT armed |
| Dependabot PR | Arms merge via separate workflow | Handled by `dependabot-auto-approve.yml` + `dependabot-auto-merge.yml` |
| Gate decision visibility | None | Written to step summary on every evaluation |

## Operational notes

- Workflow automation does not bypass branch protection, required checks, required reviews, or repository/org policy.
- Emergency disable remains available with GitHub Actions workflow disable.
The following bot actors are supported by the policy:

- `dependabot[bot]` (via the dedicated Dependabot workflow)
- Any other approved bot account that carries the `auto-merge` label

Human users are never eligible for auto-merge.

## Strongly Recommended: Add Branch Protection

This workflow does not substitute for branch protection. Without it, a passing
workflow can still produce an unreviewed merge. Recommended settings for `main`:

- Require at least 1 approving review
- Require status checks: `test-and-build`, `CodeQL`
- Restrict force pushes and deletions

To apply via CLI (requires admin permission):

```bash
gh api repos/RocketDelivery2/github-copilot-jackhammer-service/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["test-and-build"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1}' \
  --field restrictions=null
```
