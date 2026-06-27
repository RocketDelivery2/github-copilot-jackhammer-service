# JackHammer Project Monitor

Monitor the GitHub Copilot JackHammer Service repository.

Repository:
RocketDelivery2/github-copilot-jackhammer-service

Purpose:
Run a read-only project health check and report only meaningful findings, blockers, validation changes, or recommended next actions.

Current focus:
Adaptive Execution Queue, preview-only automation, CI/build/test/lint integrity, and production-readiness guardrails.

Each run:

1. Inspect repository status from the checked-out workspace.
2. Determine whether the expected adaptive queue files exist:
   - docs/ADAPTIVE_QUEUE.md
   - src/orchestration/types.ts
   - src/orchestration/parser.ts
   - src/orchestration/signals.ts
   - src/orchestration/rebalance.ts
   - src/orchestration/parallelism.ts
   - src/orchestration/orchestration.test.ts
3. Check whether package-lock.json exists.
4. If dependencies can be installed from the lockfile, run:
   - npm ci
   - npm test
   - npm run build
   - npm run lint
5. Summarize:
   - changed files, if any
   - missing expected files
   - validation status
   - exact failures
   - smallest recommended next fix
6. Do not edit files.
7. Do not commit, push, create PRs, merge, rebase, delete branches, or rewrite Git history.
8. Do not read, print, modify, infer, or request secrets, tokens, .env values, credentials, deployment settings, or auth material.
9. Do not repeatedly retry network installs if dependency installation fails.
10. Do not change production scheduling behavior.

Output format:

## Status

## Findings

## Validation

## Recommended next action
