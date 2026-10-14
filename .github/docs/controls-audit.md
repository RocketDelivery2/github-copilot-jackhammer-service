# Controls audit

## Purpose

`controls-audit.yml` runs on a daily schedule and on manual dispatch to detect security-control drift in main-branch protection and merge-automation workflows.

## Controls validated

### Branch protection (`main`)

When the GitHub protection endpoint is readable, the audit checks for required pull requests and at least one approving review, strict/up-to-date branches, required `test-and-build` and `Analyze (javascript-typescript)` checks, disabled force pushes, and disabled branch deletions.

An HTTP 403 is reported as **UNKNOWN / INCOMPLETE**, not as evidence of configuration drift. The run still fails so the lack of evidence is visible, but it does not open a drift issue based only on an authorization failure. Other API failures are also reported as unverified rather than misclassified as a settings result.

### Workflow guardrails

The audit verifies that both native auto-merge arming workflows:

- block the `no-auto-merge` deny label;
- have a step-summary decision record;
- expose and use a `do_arm == true` guard for every `gh pr merge` command.

It also verifies that `.github/workflows/auto-merge.yml` has no approval or merge authority, and checks for key identity, exact-head, branch, and changed-file controls in the safe policy. Dependabot automation must include `npm ci` and `dependabot/fetch-metadata`.

## Drift behavior

Confirmed workflow/control drift writes details to the run summary, opens or appends to an issue titled `Controls audit drift detected on main`, then fails. Unreadable settings produce an incomplete audit and fail the run without opening a drift issue solely because of HTTP 403.

## Remediation

1. Open the failed `controls-audit` run and review its summary.
2. Distinguish confirmed drift from an UNKNOWN/INCOMPLETE settings read.
3. For an HTTP 403, have a repository owner inspect settings or grant the minimum read permission needed by the audit; do not infer a setting value.
4. For confirmed workflow drift, restore the reviewed policy and update `.github/docs/auto-merge-policy.md` in the same PR.
5. Re-run the audit. Close a drift issue only after the audit passes.

## Change management

Do not modify merge-policy workflows without PR review by a human maintainer and exact-head validation. The audit detects repository-file controls only; it does not configure repository settings or prove runtime token identity.
