# AGENTS.md

## Repository

Project: GitHub Copilot JackHammer Service
Repository: RocketDelivery2/github-copilot-jackhammer-service

JackHammer is a TypeScript/Node automation service for safely analyzing repositories, generating prioritized work, coordinating AI coding/review agents, capturing command and CI feedback, and moving changes through guarded GitHub PR workflows.

## Operating posture

Work like a senior production engineer.

Prefer:

- small, reviewable changes
- deterministic logic
- pure functions for orchestration, parsing, scoring, scheduling, queue behavior, and policy logic
- explicit tests for behavior changes
- simple TypeScript over clever abstractions
- disabled-by-default preview behavior for unfinished automation

Avoid:

- broad rewrites
- unrelated cleanup
- formatting churn
- dependency churn
- large multi-area refactors
- runtime behavior changes hidden inside docs/test PRs

## Autonomy

For routine work inside this repository:

- Read files freely.
- Edit focused files when the task clearly requires it.
- Add source, tests, docs, prompts, and workflow files when directly relevant.
- Run local validation without asking first.
- Install dependencies only from the existing lockfile.
- Fix build, test, lint, and type errors with the smallest targeted correction.
- Continue until the requested task is complete or blocked by a real external limitation.

Do not ask for confirmation for normal repository inspection, focused edits, or validation.

Stop or ask when work requires:

- secrets or credentials
- auth changes
- deployment settings
- production infrastructure changes
- branch protection or repository policy changes
- destructive filesystem actions
- force-push, rebase, reset, history rewrite, or branch deletion
- broad dependency upgrades
- weakening CI, security, tests, or validation gates

## Secret and credential rules

Never print, expose, commit, copy, infer, request, or inspect:

- API keys
- tokens
- cookies
- `.env` contents
- credentials
- SSH keys
- certificates
- private auth material
- GitHub tokens
- deployment secrets
- secret-management configuration values

Never modify `.env`, credential files, auth tokens, deployment secrets, or secret-management config unless explicitly instructed.

## Git rules

Before editing, inspect repository state with:

- `git status --short --branch`

Treat pre-existing uncommitted changes as user-owned.

Default rules:

- Work on the current branch unless explicitly told to create or switch branches.
- Do not overwrite user changes.
- Do not push unless explicitly instructed.
- Do not merge unless explicitly instructed and policy gates pass.
- Do not force-push.
- Do not rebase public branches.
- Do not delete branches.
- Do not rewrite Git history.
- Do not commit `.vs/`, `.jackhammer-agent/`, local logs, generated secrets, or machine-local state.

## Windows command rules

On Christophers Windows development host, use:

- `npm.cmd ci`
- `npm.cmd test`
- `npm.cmd run build`
- `npm.cmd run lint`

Do not change PowerShell execution policy.

Do not use interactive editors for automated work.

Prefer compact inspection commands:

- `Get-Content <file> -TotalCount 160`
- `Get-Content <file> -Tail 80`
- `Select-String -Path <file> -Pattern "<term>" -Context 4,8`

## GitHub Actions command rules

On Linux GitHub-hosted runners, use:

- `npm ci`
- `npm test`
- `npm run build`
- `npm run lint`

Use least-privilege workflow permissions.

Read-only monitor/reviewer workflows should use:

- `permissions: contents: read`

Only workflows that intentionally write comments, checks, branches, or pull requests may request write scopes, and those scopes must be minimal.

## Validation flow

Before completing implementation work, run the narrowest relevant validation first, then the full sequence.

Preferred full validation on Windows:

- `npm.cmd ci`
- `npm.cmd test`
- `npm.cmd run build`
- `npm.cmd run lint`

Preferred full validation on Linux/GitHub Actions:

- `npm ci`
- `npm test`
- `npm run build`
- `npm run lint`

When validation fails:

1. Read the exact error.
2. Identify the smallest cause.
3. Fix only the relevant code.
4. Rerun the narrow validation.
5. Rerun the full validation.
6. Summarize changed files, validation results, and remaining risks.

Never weaken tests, delete tests, hide failures, reduce validation coverage, or bypass gates to make a task pass.

## Adaptive Execution Queue architecture

Inputs such as AI responses, PowerShell output, Codex output, Claude output, Grok output, GitHub events, PR checks, build output, lint output, and test output should become normalized execution events.

Signals from those events should:

- update current work
- inject urgent follow-up work
- reprioritize the queue
- decide the next safe command
- decide whether safe parallel work is possible
- create conversation work only when decision support is needed

AI conversations are not the queue.

AI conversations are work items triggered by ambiguity, research needs, architect decisions, agent questions, unclear failures, or unclear next steps.

## Failure-first rule

If build, test, lint, typecheck, security scan, dependency review, or CI fails, promote fix-first work ahead of feature, refactor, and documentation work.

Do not continue feature work on top of a broken baseline unless the task is explicitly to investigate the broken baseline.

## Safe parallelism

Parallelize thinking aggressively.

Parallelize writing conservatively.

Never parallelize merging.

Parallel work is allowed only when:

- dependencies are complete
- no barrier command is running
- write paths do not overlap
- work items do not share the same worktree
- read-only research can proceed independently
- branch and merge operations are serialized

Treat these as barrier-like unless the implementation proves otherwise:

- build
- lint
- test
- package install
- dependency changes
- git operations
- release operations
- repo-wide writes
- merge operations

## Production safety

Preserve current runtime behavior unless the task explicitly asks to change it.

Unfinished automation must be preview-only, disabled by default, and covered by tests.

Do not wire preview adaptive queue behavior into production scheduling unless the task explicitly requests it and the change remains safely gated.

## Preferred response format

1. Brief plan
2. Changed files
3. Validation commands run
4. Results
5. Remaining risks or next step
