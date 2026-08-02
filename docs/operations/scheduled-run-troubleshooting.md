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

## Recovery steps

- Re-run in dry-run mode first if the failure path is unclear.
- Fix the underlying config or permission issue before re-enabling automation.
- If the failure is tied to one queue item, leave the item blocked and let the next run continue after the blocker is cleared.
- If the failure is systemic, disable the schedule until the root cause is corrected.

## Rollback

- Disable the schedule or set the relevant automation flag back to its safe default.
- Revert any doc-only changes if they were part of a bad operational update.
- Do not bypass branch protection or relax checks to make the run succeed.
