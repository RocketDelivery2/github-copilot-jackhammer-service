# Controls Audit

## Purpose

`controls-audit.yml` runs on a daily schedule and on manual dispatch to detect
security-control drift in merge protections and merge automation workflows.

## Controls validated

### Branch protection (`main`)

The audit expects all of the following:

1. Pull requests are required before merge (`required_pull_request_reviews` present).
2. At least 1 approving review is required.
3. Required status checks include:
   - `test-and-build`
   - `CodeQL`
4. Strict/up-to-date enforcement is enabled (`strict: true`).
5. Force pushes are disabled.
6. Branch deletions are disabled.

If the workflow token cannot read the protection settings, the audit reports one
failure stating that the rules are UNKNOWN, rather than reporting each rule as
disabled.

### Workflow guardrails

The audit validates `.github/workflows/safe-automerge.yml`, the only workflow
allowed to merge PRs:

1. Merges are pinned to the evaluated head (`--match-head-commit`).
2. Merging is gated on the owner variable `AUTOMERGE_MODE == 'enforce'`.
3. Eligibility comes from the shared policy (`src/automerge-eligibility-cli.ts`).
4. It does not run on `pull_request` or `pull_request_target` events.

It also scans every other workflow and fails if any of them:

1. merges a PR (`gh pr merge`),
2. submits a PR approval,
3. merges with `--admin`, or
4. arms an `--auto` merge.

## Drift behavior

If drift is detected:

1. The workflow writes detailed failures in the run summary.
2. The workflow opens (or appends to) an issue titled:
   - `Controls audit drift detected on main`
   with label `controls-audit`.
3. The workflow exits with failure (`exit 1`) to fail loudly.

## Remediation steps

1. Open the failed `controls-audit` run and review the summary table.
2. Open the linked/new `controls-audit` issue and copy the failure details.
3. Restore missing controls:
   - Reapply `main` branch protection settings, or
   - Restore workflow gate conditions and summary logging.
4. Re-run `controls-audit` via **Actions → controls-audit → Run workflow**.
5. Close the `controls-audit` issue after a passing run.

## Change management rule

Do not modify merge-policy workflows without PR review by a human maintainer.
Any approved policy change must include a corresponding update to this document.