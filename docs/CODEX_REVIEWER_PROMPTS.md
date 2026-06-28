# Codex Reviewer Prompt Index and Usage Runbook

This document indexes the repository-level Codex reviewer prompts and defines how they should be used safely during JackHammer development.

## Purpose

The prompts under `.github/codex/prompts/` provide a read-only review layer for repository health, PR quality, production readiness, and merge safety.

They are intended to support small, validated PRs by making review expectations explicit before runtime automation is expanded.

## Prompt inventory

| Prompt | Primary purpose |
| --- | --- |
| `project-monitor.md` | Read-only repository health and validation monitor. |
| `architecture-reviewer.md` | Architecture and design review for scope, coupling, maintainability, and production safety. |
| `safety-test-reviewer.md` | Safety and test review for validation gaps and guardrail coverage. |
| `security-reviewer.md` | Security review for secrets, auth, permissions, shell execution, and unsafe automation. |
| `dependency-reviewer.md` | Dependency and supply-chain review for package, lockfile, workflow, and Docker risk. |
| `docs-reviewer.md` | Documentation and runbook review for accuracy, drift, and unsafe instructions. |
| `regression-test-planner.md` | Read-only planner for targeted regression coverage. |
| `release-manager.md` | Release-readiness review for validation, scope, rollback, and operational risk. |
| `azure-readiness-reviewer.md` | Azure/cloud readiness review without enabling deployment prematurely. |
| `merge-governor.md` | Final merge-readiness review based on scope, checks, branch protection, and safety. |

## Recommended usage

Use these prompts as review lenses, not as write-capable automation.

For a normal PR review:

1. Run or inspect CI first.
2. Use `project-monitor.md` for broad repository status.
3. Use the most relevant specialist prompt for the PR type.
4. Use `regression-test-planner.md` when behavior changes or risk increases.
5. Use `release-manager.md` for release or production-readiness decisions.
6. Use `merge-governor.md` only after the PR is ready and checks are known.

## Prompt selection guide

| Change type | Prompt to use first | Follow-up prompt |
| --- | --- | --- |
| Runtime architecture change | `architecture-reviewer.md` | `regression-test-planner.md` |
| Test or validation change | `safety-test-reviewer.md` | `regression-test-planner.md` |
| Secret, auth, shell, or permission change | `security-reviewer.md` | `merge-governor.md` |
| Dependency, workflow, package, or Docker change | `dependency-reviewer.md` | `security-reviewer.md` |
| README, docs, prompt, or runbook change | `docs-reviewer.md` | `merge-governor.md` |
| Azure or deployment-readiness change | `azure-readiness-reviewer.md` | `release-manager.md` |
| Final pre-merge check | `merge-governor.md` | none |

## Safety rules

- Treat every prompt in this directory as read-only unless a separate trusted workflow explicitly grants write capability.
- Do not use these prompts to bypass CI, CodeQL, dependency review, branch protection, reviews, or required checks.
- Do not use admin merge, force-push, disabled checks, skipped validation, or branch-protection bypass as part of normal operation.
- Do not read, print, infer, summarize, copy, or request secret values, tokens, `.env` contents, credentials, cookies, SSH keys, certificates, connection strings, publish profiles, or deployment settings.
- Prompt-only changes do not imply runtime behavior changes.
- Runtime automation must remain disabled by default until explicit production-readiness gates exist.

## Merge expectations

A PR should not be merged until:

- It targets the expected base branch.
- It is ready for review, not draft.
- Required checks have completed successfully.
- Tests, build, and lint pass when relevant.
- The scope is narrow and understandable.
- Risky runtime behavior has targeted regression coverage.
- Security, dependency, auth, workflow-permission, Azure, and deployment changes have elevated review.

## Local validation

Before merging prompt or documentation changes, run:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run lint
```

The GitHub Actions workflow should also pass before merge.

## Operating model

These prompts establish review roles before additional automation is wired into the project.

The expected progression is:

1. Keep prompt behavior read-only.
2. Document prompt selection and merge expectations.
3. Add inventory checks so missing prompts fail fast.
4. Add safe prompt-loading or prompt-index utilities.
5. Add runtime automation only behind explicit disabled-by-default flags.
6. Require tests for every new automation boundary.

## Next recommended implementation work

After this runbook exists, the next safe implementation PR is a small prompt inventory integrity test that verifies all required prompt files exist and remain named consistently.
