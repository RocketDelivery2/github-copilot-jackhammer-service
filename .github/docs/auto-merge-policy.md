# Auto-Merge Policy

## Overview

The `auto-merge.yml` workflow arms squash auto-merge on qualifying PRs targeting `main`.
It is **not** a universal merge gate — human-authored PRs require explicit opt-in via
the `auto-merge` label.

## Safety Gates (ALL must pass)

| # | Gate | Condition | Block behavior |
|---|------|-----------|----------------|
| 1 | Draft check | PR must not be in draft state | Blocked until marked ready for review |
| 2 | Explicit allow | PR must have `auto-merge` label OR author is `dependabot[bot]` | Blocked; add label to opt in |
| 3 | Policy labels | PR must NOT have `security`, `breaking-change`, or `do-not-merge` label | Blocked unconditionally; requires human merge |

If any gate fails, auto-merge is NOT armed. The reason is written to the
workflow step summary for every evaluation (pass or block).

## How to Use

### Enable auto-merge for a PR

1. Ensure the PR is marked **ready for review** (not draft).
2. Add the **`auto-merge`** label.
3. The workflow evaluates gates on the next trigger event (label add, push, or
   `ready_for_review`). If all gates pass, squash auto-merge is armed and will
   fire when required checks complete.

### Disable auto-merge for a specific PR

- Remove the `auto-merge` label, **OR**
- Add the `do-not-merge` label (blocks Gate 3 unconditionally).

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
| PR opened (no label) | Auto-approves + arms squash merge | Gate 2 blocks; merge NOT armed |
| PR with `auto-merge` label, not draft | Arms merge | All gates evaluated; arms if all pass |
| Draft PR with `auto-merge` label | Arms merge | Gate 1 blocks; merge NOT armed |
| PR with `security` label | Arms merge | Gate 3 blocks; merge NOT armed |
| Dependabot PR | Arms merge via separate workflow | Handled by `dependabot-auto-approve.yml` + `dependabot-auto-merge.yml` |
| Gate decision visibility | None | Written to step summary on every evaluation |

## Allowed Bot Actors

The following bot actors are treated as having an implicit explicit-allow (Gate 2 pass):

- `dependabot[bot]`

All other actors — including human users and other bots — must add the `auto-merge` label.

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