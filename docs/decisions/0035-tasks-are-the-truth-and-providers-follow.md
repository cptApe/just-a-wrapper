# The task row is the truth, and the provider follows it

- **Status:** Accepted
- **Date:** November 2026

## Context

A scheduled task lives in two places: our `task` row and its Anthropic deployment (an event task: its Composio trigger). Edits, pauses, resumes and deletes used to call the provider first and write the row after, guarded by `updated_at`. That left gaps:

- Two edits at once could leave the row with one cron time and the provider with the other, and nothing repaired it.
- A pause during an edit made the edit fail after the provider had taken it, and the provider's own pause webhook could look like an outside pause and send a false "paused because a dependency needs attention" alert.
- "Run now" stayed locked for five minutes after a run that had already started.
- A deployment snapshots what the agent is told about its creator. A change of time zone, language or name did not reach it until the prompt was edited.
- Event tasks had no plan limit and no cap on parallel runs (audit finding F071).

## Decision

- **A version, not a timestamp.** `task.version` counts every change to what a task is: its definition and its status. An edit names the version it read. One of two edits wins; the other gets `CONFLICT` and the form says the schedule changed and should be reloaded. `updated_at` is only a timestamp. Caches (`next_run_at`, `last_run_at`, check times, the snapshot hash) and leases do not bump the version.
- **The row first, then the provider.** A command writes the row and a mark in `task.provider_sync` in one statement: `status` when the provider must follow a new status, `definition` when it must also take a new definition. The mark is its own machine (`taskProviderSyncMachine`). A status mark never downgrades a pending definition.
- **One pusher at a time.** `syncTaskProvider` takes the row's lease (`sync_claimed_at`), reads the row, pushes it and settles the mark only if the version did not move meanwhile. If it moved, the pusher goes again. A crash leaves the mark, and the recovery sweep finishes it after the lease ends. A provider failure during a command is captured and left to the sweep; the command itself has already succeeded.
- **The provider's own echo is not news.** A deployment state webhook changes the row only when the row has no pending mark and the provider's state differs. Only then is the creator alerted.
- **One removed state.** `cancelling`, `cancelled` and "done with `removed_at`" become `removed`. `pausing` and `resuming` are gone; the mark carries the pending provider work. `deployment_cleanup` is gone; archiving a fired or removed one-off is part of the sync.
- **Run now holds a lease that ends with its run.** The lease (`run_now_claimed_at`) ends as soon as the run is adopted or definitely refused. After an unanswered call, the sweep reads the deployment's run log: a recorded run ends the lease; no record after ten minutes means no run started.
- **Creator facts are re-synced, not read at run start.** The provider starts a scheduled run from the deployment's stored initial events, before our code sees it, so the run cannot read them itself. The snapshot fingerprint includes the creator's name, time zone, reply language and workspace name, and a change marks the deployment for a definition push. A save pushes at once: `syncCreatorTasks` in `tasks/api/sync-creator-tasks.ts` marks every live schedule the person created and pushes each, after the response (`scheduleCreatorTaskSync`). Three writers call it: the Settings → General actions for time zone and language (`settings/api/preference-actions.ts`, which sit above both features because preferences is a lower layer than tasks), the browser time zone route when the person is on Auto, and the Better Auth `user.update` hook when the name changes. The recovery sweep's snapshot check stays the fallback, and still catches a renamed workspace.
- **Event tasks share the schedule limit and cap their live runs.** An event task takes a slot from the same plan limit as a schedule, under the same lock, with the same message. A delivery that arrives while the task already has three live runs (`EVENT_TASK_MAX_LIVE_RUNS`) is **dropped with a record**: its receipt is stored as `skipped` with reason `run_limit` and logged. We drop rather than queue because a queue would need to store each event payload and replay it later, and a burst of mail usually does not need every message handled by a separate run.

## Why

The row is what the user sees and what our code reads, so it must never be the copy that is wrong. Writing it first, with a durable note of what the provider still owes, makes every crash point converge: either the provider matches, or the note is there and a sweep finishes it. A version turns concurrent edits into a plain guarded update instead of a race against the provider. The provider calls stay outside every database lock (decision 0014).

## Consequences

- Every write of `status`, `provider_sync`, `sync_claimed_at` and `run_now_claimed_at` lives in `tasks/api/task-transitions.ts` (lint map in `no-machine-status-write.mjs`).
- `task-deployments.ts` creates, edits, pauses and runs task deployments on Anthropic; `composio-triggers.ts` is the one module that talks to Composio about triggers; `sync-task-provider.ts` decides which to call. Three other callers touch a deployment for their own job: stopping a workspace archives them, run adoption reads one, and budget sync updates its budget.
- A saved name, time zone or language reaches a deployment right after the save. A push that fails keeps its mark for the recovery sweep. A renamed workspace still waits for the next recovery pass that checks the task.
- The owner confirmed dropping events past three live runs for launch.
- A paused-but-unpushed schedule can still fire once if the provider's tick lands before the push; this window existed before as the `pausing` state.
- A one-off whose provider time does not match after a push is paused, with the edit kept, instead of cancelled.
- Bursts of events past the cap are not processed. Raising the cap or adding a queue is a change to this record.
