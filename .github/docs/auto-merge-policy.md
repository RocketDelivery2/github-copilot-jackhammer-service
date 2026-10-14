# Auto-merge policy

## Authority boundary

The workflows in this document may request GitHub's native auto-merge only after every policy gate passes. They never call an admin/bypass merge. GitHub branch protection and repository settings remain independent required controls; this code does not configure or prove those settings.

`.github/workflows/auto-merge.yml` only opens a **draft** PR for a newly created branch. It has no approval or merge permission. `.github/workflows/safe-automerge.yml` is the general policy gate. `.github/workflows/dependabot-auto-merge.yml` adds the Dependabot update-type gate and uses the same pure policy evaluator.

There is no label-based human or `github-actions[bot]` author bypass. The explicit `auto-merge` label is an opt-in signal, not an override for any other gate. `no-auto-merge`, `security`, `breaking-change`, and `do-not-merge` always block.

## Shared fail-closed gates

The pure `src/auto-merge-policy.ts` evaluator requires:

1. Well-formed PR metadata; missing or malformed values block.
2. The PR author and latest head-commit author are the same exact allowlisted bot: `dependabot[bot]` or `renovate[bot]`. `github-actions[bot]` is not an allowed author.
3. The head branch uses the corresponding `dependabot/` or `renovate/` prefix.
4. The PR is open, ready (not draft), and targets `main`.
5. Every changed path is in the Markdown/documentation/test allowlist. `.github/**`, package manifests and lockfiles, `src/config.ts`, `src/github.ts`, path traversal, and all other files are denied. The Dependabot-only exception permits package manifests/lockfiles only for direct development-dependency patch/minor updates; it does not permit application source changes.
6. No deny label is present. The general workflow also requires the `auto-merge` opt-in label.
7. `reviewDecision` is exactly `APPROVED` and at least one approving review is from a non-author, non-bot identity.
8. `test-and-build` and `Analyze (javascript-typescript)` have completed successfully for the exact head SHA.
9. GitHub reports `mergeStateStatus` exactly `CLEAN`.
10. Dependabot mode additionally requires fetch-metadata to report a direct development dependency patch or minor update. Missing metadata and major/other update types block.

All merge-arm steps require the evaluator's `do_arm == true` output. The evaluator returns `doArm: false` if native auto-merge is already enabled, making repeated events a no-op.

## Event and reporting behavior

Policy workflows evaluate PR open/synchronize/reopen/ready/label events, review submissions, completed checks, and manual dispatch on `main`. Decisions are written to the workflow run summary; the safe-automerge workflow does not post PR comments.

The Dependabot auto-approve workflow is a separate control and is not changed here. Its approval is not sufficient for this policy: the merge evaluator requires an independent non-bot approval. Review that workflow separately before broadening unattended dependency automation.

## Required owner-managed controls

The workflow code cannot substitute for GitHub repository settings. A repository owner should independently configure and verify required approving reviews, required exact status checks, strict up-to-date branches, enforcement for administrators, and disabled force-push/deletion. This PR does not change those settings. Do not use `enforce_admins: false` as remediation guidance.
