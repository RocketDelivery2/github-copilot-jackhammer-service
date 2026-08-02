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

### Workflow guardrails

The audit validates both:

- `.github/workflows/auto-merge.yml`
- `.github/workflows/dependabot-auto-merge.yml`

Expected controls in each workflow:

1. Deny-label blocking for `security`, `breaking-change`, and `do-not-merge`.
2. Guarded merge execution path (`if: steps.gates.outputs.gate_pass == 'true'`).
3. Decision logging to workflow summary (`$GITHUB_STEP_SUMMARY`).
4. No unconditional merge path (`gh pr merge` commands must remain gated).

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