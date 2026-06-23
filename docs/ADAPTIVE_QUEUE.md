# Adaptive Execution Queue

The Adaptive Execution Queue is a future orchestration layer for turning plans, agent output, validation results, and human decisions into a deterministic work queue. It is guarded by `ADAPTIVE_QUEUE_ENABLED=false` by default. When disabled, `src/index.ts` continues using the existing scheduling flow and does not write adaptive journal records. When enabled, the service can build a preview from current runtime state without replacing current behavior.

## Runtime Adapter

`src/orchestration/adapter.ts` maps existing `ActiveWorkItem`, `CommandQueueItem`, `CopilotGuidance`, and recent Copilot result inputs into `WorkItem` and `QueueSignal` records. The adapter is deterministic and side-effect free. The current runtime branch only produces an adaptive preview when `ADAPTIVE_QUEUE_ENABLED=true`; legacy scheduling remains active.

## Command Capture

`src/orchestration/command-runner.ts` provides an isolated command execution capture primitive for future adaptive feedback loops. It records the displayed command, executable, args, cwd, stdout, stderr, exit code, start and completion timestamps, duration, timeout, and timed-out state.

The runner uses `spawn` with `shell: false` and a finite timeout by default. It is not wired into production scheduling, so no command is executed by the runtime flow unless future code explicitly calls it behind an enabled feature flag.

When `ADAPTIVE_QUEUE_ENABLED=true`, runtime preview capture source is explicitly configured with `ADAPTIVE_PREVIEW_CAPTURE_SOURCE` (`none`, `recent-results`, `validation-probes`) and capped by `ADAPTIVE_PREVIEW_CAPTURE_LIMIT` (default `3`). For `validation-probes`, commands come from `ADAPTIVE_PREVIEW_VALIDATION_PROBES` as a JSON array. This capture path is preview-only and does not control production scheduling order.

Captured results can be converted into `ExecutionEvent` records and `QueueSignal` records. Build, test, and lint output flows through the existing signal classifier, while timed-out or otherwise unclassified nonzero exits become blocker signals.

## Event Journal

`src/orchestration/event-journal.ts` provides preview-only JSON persistence for captured adaptive queue feedback. It stores `ExecutionEvent` records and `QueueSignal` records with a `createdAt` timestamp, source identifier, and optional `workItemId`.

When `ADAPTIVE_QUEUE_ENABLED=true`, the preview adapter may append adaptive preview records to `ADAPTIVE_EVENT_JOURNAL_PATH` (default: `.ai/adaptive-preview-event-journal.json`) using `ADAPTIVE_EVENT_JOURNAL_RETENTION` (default: `200`). This remains isolated from production scheduling and does not alter legacy queue execution.

The journal is intentionally isolated from production scheduling. Loading a missing journal file returns an empty list, appending records preserves existing entries, malformed journal contents fail with a clear error, and a retention helper can keep only the latest N records.

## Feedback-Driven Queue

Queue items are represented as `WorkItem` records. They can be feature/refactor work, fix-first items, validation commands, research tasks, conversation tasks, shell commands, or agent commands. Execution output is converted into `QueueSignal` records, then the queue is re-scored in a deterministic order.

The queue responds to these signals:

- `build_failure`, `test_failure`, and `lint_failure` create or promote a fix-first item.
- `agent_question`, `missing_tests`, `needs_research`, and `needs_architect_decision` create conversation work.
- `urgent` promotes a targeted item.
- `blocker` pushes a targeted item behind runnable work.

## Barrier Commands

Barrier commands are work items that must run alone because they mutate shared execution state. Examples include dependency installs, branch changes, merges, rebases, resets, and other commands marked with `isBarrier`.

When a barrier command is running, no new runnable batch is planned. When a pending barrier command is next, it is scheduled as a single-item batch.

## Safe Parallelism

Two work items can run in parallel only when all safety checks pass:

- Their write paths do not overlap, including parent/child path overlap.
- Their dependencies are complete.
- No barrier command is running or selected alongside them.
- They do not share the same worktree.

`planRunnableBatch(queue, maxParallel)` preserves queue order while selecting only safe pending items.

## Conversation Triggers

Conversation work is created when the system detects that execution cannot continue safely without input. The current triggers are agent questions, missing test coverage, research needs, architecture decisions, and blockers.

Conversation work is deterministic: its ID is derived from the signal kind and source work item ID. Rebalancing will not create duplicates for the same signal.

## Rebalancing Rules

Rebalancing is score based and deterministic. Higher scores run earlier, and original order breaks ties.

Fix-first behavior is the strongest rule: build, test, or lint failures inject or promote a `fix` item ahead of remaining feature and refactor work. Urgent signals then promote targeted work. Blocked items and items with incomplete dependencies are deprioritized. Completed and skipped work is kept at the end.

