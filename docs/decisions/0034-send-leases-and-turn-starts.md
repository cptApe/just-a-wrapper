# A send holds a lease, and a turn starts in one place

- **Status:** Accepted
- **Date:** November 2026

## Context

A message send is not idempotent at the provider. `session_send` keeps one row per client message id, so a retry can find out whether the first attempt landed. Recovery took over a `sending` row one minute after its last write. One send can last longer than that: a budget refresh, a 30 second post, a budget probe and a second post. Recovery then read the provider log, found nothing yet, marked the row failed, and the browser's retry posted the message a second time. The sender that was still in flight could also settle the row over the new owner.

Opening messages had two paths. A chat created without attachments posted its first message with a raw provider call inside `startChatSession`. A deferred chat went through the send service. Analytics, budget recovery and forged-tag stripping differed between them.

The chats-at-once limit was checked only when a chat was created. A chat created with its opening deferred, or an idle chat that got a new message, started a turn without any check.

## Decision

**Send lease.** `session_send` gets `attempt_token` and `recover_after`. A claim writes a fresh token and a lease that ends three minutes later, on the database clock. Right before each provider post, `sendMessage` renews the lease with a compare on the token; if the renewal fails, it does not post. Only a row whose `recover_after` has passed can be taken over (`sending` to `unconfirmed`). Settling a send (`finishSessionSend`) compares the token, so a sender that lost its lease cannot write a result. An `unconfirmed` row keeps its token, and recovery compares it, so a stale provider-log read cannot fail a later attempt. A CHECK ties token and deadline to the two open states.

**One opening path.** `sendOpeningMessage` in `session-runtime/api/start-turn.ts` is the only way an opening reaches the provider. New chats, task runs and deferred chats all use it, through the same `sendMessage` as every other send.

**Turn starts.** A chat turn starts at its opening and at a send into an idle chat. Both run the chats-at-once check under the workspace capacity lock (`withChatCapacity`). The deferred opening claim commits inside that lock. A send into an idle chat holds no slot, because the provider, not our row, reports the turn as running. A refusal first reconciles stale statuses once, then checks again.

**Archive lifecycle.** A hidden session is terminal and an archived one is hidden. Two CHECKs (`session_hidden_check`, `session_archive_check`) make every other combination impossible to write, and `awaitingProviderArchive` names the one predicate the sweep and the probe use. Hiding an already ended session keeps its end time.

## Why

A lease with an owner token is the pattern the budget sync already uses. It turns "recovery may act" into one comparison on the database clock instead of a guess about how long a send takes. Renewing right before each post bounds the time between a valid lease and the post by the provider timeout, which is far shorter than the lease.

One opening path means a fix to openings reaches every chat. Checking the limit where the turn starts is the only place that sees every way a turn begins.

## Consequences

- The lease must stay longer than the slowest send. Raise `SEND_LEASE_SECONDS` when a send gains another provider call.
- Two sends into two idle chats at the same instant can both pass the limit. Closing that needs a local running claim that the provider cannot contradict, which we do not have.
- The expired-pause marker (`ended_at` on a `paused_no_credits` task run) stays. It is the run's end time for the scheduled list, and the tasks feature reads it.
- The one-off repair of idle rows at version 0 is gone. Migration `0008` counts any such row left as opened.
