# Unattended auto-merge policy

## Summary

Exactly one workflow can merge pull requests without a human clicking merge:
`.github/workflows/safe-automerge.yml`. It merges only PRs that match an explicit,
low-risk task-type allowlist, only at the exact head SHA it evaluated, and only
after the repository owner enables it.

No workflow approves PRs, arms `--auto` merges, merges with `--admin`, or bypasses
branch protection or required checks. Labels can block a merge but never
authorize one.

The policy is implemented as pure, tested code in `src/automerge-eligibility.ts`
(tests: `src/__tests__/automerge-eligibility.test.ts`). Workflow guardrails are
tested in `src/__tests__/automation-workflows.test.ts` and re-checked daily by
`controls-audit.yml`.

## Activation (owner-controlled, off by default)

| Repository variable | Meaning | Default |
|---|---|---|
| `AUTOMERGE_MODE` | `enforce` merges eligible PRs. Any other value, or unset, is preview: evaluate and report only. | unset (preview) |
| `AUTOMERGE_ENABLED_TASK_TYPES` | Comma-separated task types allowed to merge: `dependabot-patch`, `docs-only`. An unknown name disables all task types. | unset (none) |

Preview runs write every decision to the workflow step summary so the owner can
observe behavior before enabling `enforce`.

## Triggers

- `workflow_run` after `test-and-build` completes (evaluates that run's PRs at that run's head SHA)
- hourly `schedule` sweep of open PRs targeting `main`
- `workflow_dispatch` from `main` only, optionally for one PR number

The workflow never runs on `pull_request` or `pull_request_target`, never checks
out PR code, and runs the evaluator from `main`.

## Allowlisted task types

A PR is classified by author and head-branch prefix only. Anything else is
`unknown` and blocked.

### `dependabot-patch`

- Author is exactly `dependabot[bot]`; head branch starts with `dependabot/npm_and_yarn/`.
- Every PR commit is authored by `dependabot[bot]` and has a verified signature.
- Changed files are only `package.json` and/or `package-lock.json`.
- Patch-only is verified from the manifests at the PR base and head SHAs, not from
  PR titles or commit messages:
  - `package.json` is unchanged except dependency ranges, and every changed range keeps its operator and bumps only the patch version;
  - `package-lock.json` keeps the same lockfile version and package set;
  - every changed package version is a strictly higher patch of the same major.minor;
  - entries whose version did not change are byte-for-byte equal (canonical JSON);
  - bumped entries change only version/resolution/integrity/dependency metadata and resolve to `https://registry.npmjs.org/`.

Minor, major, downgrade, added, removed, script, and metadata changes are blocked.

### `docs-only`

- Head branch starts with `docs/`.
- Every changed file is Markdown under `docs/` or the root `README.md`
  (`AGENTS.md`, `CLAUDE.md`, and `.github/**` are excluded).
- A human (non-bot) reviewer other than the PR author approved the exact head
  commit, and no reviewer's latest review requests changes.

## Gates applied to every PR

All must pass; any missing, stale, malformed, or conflicting evidence blocks.

| Gate | Requirement |
|---|---|
| Repository | Running in `RocketDelivery2/github-copilot-jackhammer-service` |
| Exact head | Observed head SHA equals the evaluated SHA (40 lowercase hex) |
| Open and ready | `OPEN`, not draft |
| Base branch | `main` |
| Same repository | Not from a fork |
| Deny labels | None of `security`, `breaking-change`, `do-not-merge`, `no-auto-merge`, `needs-review` |
| Merge state | `mergeStateStatus == CLEAN` |
| Review decision | Not `CHANGES_REQUESTED` or `REVIEW_REQUIRED` |
| Required checks | Every `test-and-build` and `CodeQL` result on the head is successful; no check on the head has failed |
| Changed-file evidence | File list is complete, non-empty, duplicate-free, and below the 100-file listing limit |
| Task type | Exactly one allowlisted task type |

The merge job then runs `gh pr merge --squash --match-head-commit <sha>` with
`contents: write` and `pull-requests: write` only. GitHub still enforces branch
protection and required checks at merge time and rejects a moved head.

## Requires a human

Everything outside the two task types above, including any change to
`.github/**`, workflow permissions, dependency minor/major updates, runtime,
auth, or configuration code, RepoSeed/RepoDiscovery, and any PR carrying a deny
label. Repository settings, branch protection, secrets, and enabling
`AUTOMERGE_MODE=enforce` are owner actions.

## Recommended branch protection for `main` (owner setting)

- Require a pull request with at least 1 approving review; require review from code owners for `.github/**`
- Require status checks `test-and-build` and `CodeQL`; require branches to be up to date
- Include administrators (`enforce_admins: true`); no bypass actors
- Disallow force pushes and deletions

Note: if required approving reviews are enabled, `dependabot-patch` PRs will
wait for a human approval, because no workflow approves PRs.

## Emergency stop

Unset `AUTOMERGE_MODE` (or set it to anything other than `enforce`), or disable
the `safe-automerge` workflow in the Actions tab.
