# One spend gate for every paid entry point

- **Status:** Accepted
- **Date:** November 2026

## Context

Paid work was checked by four functions and a session budget, and each entry point remembered a different subset. `assertWorkspaceHasCredits` ran `assertMemberCanSpend` and then `assertWorkspaceCanAfford` for chats, sends and run-now. Media tools called `assertWorkspaceCanAfford` inside their handlers, so a member over their limit could still start a video. Web search, page fetch and the browser tools had no check at all. Scheduled runs were checked only against the workspace balance at adoption, and event-triggered runs started with no check, so a member over their limit kept spending on every tick or event. The member period was computed on the app clock while the ledger uses the database clock.

## Decision

**One gate.** `checkSpend` in `src/features/billing/api/spend-gate.ts` answers "may this person spend this estimate in this workspace now?". It reads the workspace balance and the person's remaining member allowance in one transaction, on the database clock (`deriveWorkspaceCreditBalance`, and `loadMemberCreditUsage` with `readDatabaseClock`). It refuses when either is below `max(estimate, MIN_TURN_CREDITS)`, with one `CREDITS_EXHAUSTED` error built by one helper, `spendRefusal`, so the two refusals cannot drift apart. Both are expected states (`expectedState: true`), so they are not reported as incidents. The member reads "You have reached your credit limit for this billing period. Ask a workspace admin to raise it.", or "This tool needs N credits, but your credit limit leaves M; ask a workspace admin to raise it."; the balance refusal reads the top-up sentence, or "This tool needs N credits, but you have M; add credits to continue." The member check comes first, as before. Billing off allows everything. `assertCanSpend` throws the refusal for a person who is present; `checkSpend` returns it with its reason (`credits` or `member_limit`) for unattended runs. The old functions are deleted.

**Every entry point names itself.** The gate takes an `entry` of type `GatedEntryPoint` (`billing/lib/paid-entry-points.ts`). The same file names the paths that spend without a gate (turn continuations, native tools, chat titles). `tests/integration/spend-gate.test.ts` fails when a tool that spends vendor money declares no estimate.1 of the foundation spec.

**Where the gate runs.**
- A chat opens in `startChatSession`, before the provider session exists. New chats, Library tasks and Memory asks pass through it.
- Every send passes in `sendSessionMessage`, before the send claim.
- A resume passes in `claimSessionResume`, for the session's creator, whose allowance the session spends.
- Run-now passes in `runTaskNow`.
- A scheduled run passes when it is adopted. A refused run is paused with the gate's reason and the existing paused notice.
- An event-triggered run passes when its delivery is claimed. A refused delivery starts nothing: it is recorded `skipped` with reason `credits` or `member_limit`, and the workspace gets the same paused notice. There is no provider session to pause, because the gate runs before one exists.
- A tool that spends vendor money declares `estimateCredits(input, settings)`. The dispatcher resolves the caller's stored tool settings and passes the estimate to the gate before the handler runs; a refusal is the tool's error result. The tool type makes a tool that measures a cost (`measureVendorCostCents` or `mediaBilling`) without an estimate fail to compile, and the enumeration test fails for any tool whose provider capability is paid but declares no estimate. `browse_close` is the one exception: closing ends spend.
- Dictation and read-aloud pass in their voice feature functions.

**The member check uses the estimate.** A member needs the whole estimate in their remaining allowance, not just one credit. A turn's estimate is zero, so turns need one credit of allowance, as before.

**Resume takes a chats-at-once slot.** A chat leaving a credit pause starts a turn, so `claimSessionResume` checks the limit under the capacity lock in the same transaction as the move to `resuming`. A send into a paused chat at a full workspace gets the chats-at-once sentence. The resume after a top-up leaves such a chat paused for its Resume. The statuses that hold a slot are `CHAT_SLOT_STATUSES` next to the session machine: creating, opening, running, rescheduling and resuming. A chat waiting on a person (`requires_input`) holds none: it spends nothing until its next turn start passes the limit.

**A member's own limit offers no credits.** A route's error body for a member-limit refusal carries `reason: 'member_limit'` (`routeErrorResponse`), and `classifySendFailure` turns it into its own `member-limit` kind. The composer banner then shows the sentence with no button, as the paused-chat banner already did, because buying credits cannot lift a member's limit. Out of credits, every surface offers "Add credits" and opens the top-up dialog.

**Unattended budgets follow the creator.** A task run's provider budget is the smaller of the balance and its creator's remaining allowance: when an event run's session is created, when a scheduled run is adopted, and when a grant raises live budgets. A task run whose creator has no allowance left is not raised, so a top-up never resumes it into an immediate stop.

## What the gate does not do

**It reserves nothing.** Two requests that read the same balance both pass. The overspend is the cost of the work that passed in the same moment beyond what was on hand: for tools, at most the sum of the estimates of the paid calls in flight (the largest single estimate is a 15-second high-quality video, 1,023 credits); for turns, each chat is capped by its provider budget at the balance, so up to the chats-at-once limit minus one times the balance. The member limit was already soft for the same reason (§7 of the foundation spec). This is accepted because overspend becomes ledger debt that the next grant repays first, the window is the few seconds between the check and the charge, and a reservation would need a holds table released on every success, failure and crash path.

**The provider budget is a partial cap.** It is set per session, so several runs of one creator each get the whole remaining allowance and can together pass it. It counts model list cost, not tool costs. It does not rise by itself when a period resets or an admin raises a limit; the next run start, resume or grant sync sets it. Deployment templates keep the workspace balance, because a template serves runs at unknown times; a scheduled run spends under the template budget only until it is adopted. Chats keep the balance too: a person is present, and the member-limit pause after a charge covers them. The cap therefore narrows the gap between checks for unattended runs without closing it.

## Confirmed by the owner

In November 2026 the owner confirmed these as they are:

- A member is refused when their remaining allowance is below a tool's estimate, not only at zero.
- An event run with no credits is skipped with a record and the paused notice; a queued run with no provider session could not be resumed.
- Chat titles stay free and show as "On us" in usage.
- An Exa search or page read that answered but whose body cannot be parsed is charged Exa's reported cost.
- A chat waiting on a person (`requires_input`) holds no chats-at-once slot. `tests/integration/spend-gate.test.ts` ("a chat resume takes a chats-at-once slot…") seeds one beside two busy chats on a three-chat plan and the resume still passes.

## Consequences

- A member near their limit is refused an expensive tool, dictation or read-aloud whose estimate exceeds their remaining allowance, where before only the balance was checked.
- Web search, page fetch and the browser tools now need one credit on hand and one credit of allowance.
- Scheduled and event runs of a member over their limit stop at once with the member-limit notice.
- A chat that is being retried by the provider (`rescheduling`) now counts against chats-at-once.
- Adding a gated entry point means adding it to `GatedEntryPoint` and the spec table, or the gate call does not compile.
