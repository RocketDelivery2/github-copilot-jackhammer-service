# Adaptive Execution Queue

The Adaptive Execution Queue is a future orchestration layer for turning plans, agent output, validation results, and human decisions into a deterministic work queue. This first slice is intentionally not wired into `src/index.ts`; it provides pure data types and scheduling helpers that can be tested without changing current runtime behavior.

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
