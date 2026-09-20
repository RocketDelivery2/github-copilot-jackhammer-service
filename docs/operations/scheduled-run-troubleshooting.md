# Scheduled Run Troubleshooting

Date baseline: **July 26, 2026.**

Use this runbook when a scheduled or recurring JackHammer run does not complete as expected.

## First checks

1. Confirm the workflow or service actually started on schedule.
2. Check whether the run exited early because `DRY_RUN=true`, `RUN_ONCE=true`, or `FULL_AUTOPILOT=false`.
3. Review the latest job log for auth failures, missing repo access, or rate-limit errors.
4. Confirm the target branch still matches the configured base branch.

## Common failure patterns

- **No work was created:** queue generation found no eligible item or the repo snapshot was empty.
- **Run stopped after one item:** `RUN_ONCE=true` or a max-runtime limit ended the loop.
- **PR actions failed:** branch protection, missing checks, or insufficient token permissions blocked the action.
- **Copilot assignment failed:** the assignee login is missing or the cloud agent is unavailable.
- **Repeated retries without progress:** the item likely needs manual intervention or a fresh repo snapshot.

## Pull request workflow does not start

If a pull request has **no `test-and-build` run at all**, do not treat the missing check as a pass.

1. Confirm `.github/workflows/test-and-build.yml` exists on the default branch and still includes a `pull_request` trigger.
2. In **Settings → Actions → General**, confirm GitHub Actions are enabled for the repository and that the repository is allowed to run the actions used by the workflow.
3. Check the PR head SHA directly. A CodeQL or other security check does not substitute for the repository's `test-and-build` workflow.
4. Confirm the PR is not draft-only or filtered out by a branch/event condition.
5. After restoring Actions, update or rebase the PR so GitHub emits a fresh pull-request event and wait for `test-and-build` to complete.
6. For dependency, runtime, workflow, `package.json`, or lockfile changes, require an actual successful `test-and-build` result before merging.

If branch protection is also missing the required check, fix the repository rule rather than relying on the absence of enforcement. Never force-merge merely because GitHub currently reports the PR as mergeable.
## Recovery steps

- Re-run in dry-run mode first if the failure path is unclear.
- Fix the underlying config or permission issue before re-enabling automation.
- If the failure is tied to one queue item, leave the item blocked and let the next run continue after the blocker is cleared.
- If the failure is systemic, disable the schedule until the root cause is corrected.

## Rollback

- Disable the schedule or set the relevant automation flag back to its safe default.
- Revert any doc-only changes if they were part of a bad operational update.
- Do not bypass branch protection or relax checks to make the run succeed.
