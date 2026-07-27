# Auto-Merge Policy

## Overview

The `auto-merge.yml` workflow only arms squash auto-merge for approved bot-authored PRs.
Human-authored PRs are always blocked, even if they carry the `auto-merge` label.
`dependabot-auto-merge.yml` handles Dependabot separately with the same merge-readiness
checks.

## Safety Gates (ALL must pass)

| # | Gate | Condition | Block behavior |
|---|------|-----------|----------------|
| 1 | Bot author | PR author must be an approved bot | Blocked; human-authored PRs are never auto-merged |
| 2 | Policy label | Bot PRs must carry the `auto-merge` label | Blocked; add the label only for approved bot PRs |
| 3 | Draft check | PR must not be in draft state | Blocked until marked ready for review |
| 4 | Policy labels | PR must NOT have `security`, `breaking-change`, or `do-not-merge` label | Blocked unconditionally; requires human merge |
| 5 | Review gate | Required review must be approved | Blocked until the review decision is `APPROVED` |
| 6 | Check gate | Required checks must be clean | Blocked until merge state is `CLEAN` |

If any gate fails, auto-merge is NOT armed. The reason is written to the
workflow step summary for every evaluation (pass or block).

## How to Use

### Enable auto-merge for a PR

1. Ensure the PR is authored by an approved bot account.
2. Add the **`auto-merge`** label.
3. Ensure the PR is marked **ready for review** (not draft).
4. The workflow evaluates gates on the next trigger event (label add, push, or
   `ready_for_review`). If all gates pass, squash auto-merge is armed and will
   only fire after required reviews and checks are green.

### Disable auto-merge for a specific PR

- Remove the `auto-merge` label, **OR**
- Add the `do-not-merge` label (blocks Gate 4 unconditionally).

To immediately disarm an already-armed auto-merge:

```bash
gh pr merge --disable-auto <PR-URL>
```

## Emergency Disable (whole workflow)

To disable the auto-merge workflow for all new PRs immediately:

**Option A — GitHub UI:**
1. Go to **Actions → auto-merge → ⋯ (three dots) → Disable workflow**.

**Option B — CLI:**
```bash
gh workflow disable auto-merge.yml --repo RocketDelivery2/github-copilot-jackhammer-service
```

**Option C — Make workflow manual-only (edit file):**
Replace the `on:` block with:
```yaml
on:
  workflow_dispatch:  # disables all automatic triggers
```

## Rollback Steps

If a bad commit was merged via auto-merge:

```bash
# Step 1: identify the merge commit
git log --oneline -10 origin/main

# Step 2: revert the merge commit (replace SHA)
git checkout main
git pull --ff-only
git revert -m 1 <merge-commit-sha>
git push origin main

# Step 3: verify
git log --oneline -5 origin/main
```

## Before / After Behavior

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

## Allowed Bot Actors

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