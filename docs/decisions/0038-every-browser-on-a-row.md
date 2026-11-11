# Every browser is on a row, and every paid tool bills its failures

- **Status:** Accepted
- **Date:** November 2026

## Context

Four gaps let tool use run free or untracked:

- A one-shot page read (`browse_page`) was billed only from a successful result. A read that failed after the browser was created cost nothing. A short read was billed by the second, below the provider's one-minute minimum. It also had its own Browserbase rate and HTTP client.
- A task browser was created at Browserbase before any database record. A process killed in between left a live browser, with the member's signed-in context, running for up to an hour with no row and no charge.
- A call waiting for a person was stored as `claimed`, the same state as a call about to run. Every recovery path had to remember to skip it, or it would answer a waiting approval with "interrupted".
- The confirmation machine had a `resolved` state nothing could reach.

The product owner's decision: close every billing gap, page reads included.

## Decision

**A candidate row comes before every browser.** `browser_candidate` holds the intent before the provider create. The provider session is created with the candidate's id in its metadata (`browserCandidateId`), and the row records the Browserbase id once it is known. The candidate is deleted in the same transaction in which the session row takes the browser (`claimBrowser`), or after the browser is released and billed (`settleBrowserCandidate`). The browser timeout sweep releases and bills every candidate older than ten minutes, which no live route can outlast. A candidate with no stored id is found by its metadata (`GET /v1/sessions?q=user_metadata['browserCandidateId']:'<id>'`).

**Browser time is billed in one place.** `accrueBrowserTime` applies the one-minute minimum and the one-hour cap from `browser-session-math.ts` and uses the Browserbase id as the usage key. A page read, a task browser, a close, a claim-race loser and the sweep all bill through it, so a browser is billed once whichever of them gets there first. A page read therefore costs what the provider charges, whether it succeeds or fails.

**A failed release keeps the row.** When a release fails, the time so far is billed and the candidate stays, so the sweep finishes the release. The user still gets the page text or the original error.

**A paid tool's failure bills like its success.** `PaidToolError` carries what the provider is still owed: a media charge (`unsavedMediaError`, for a generation whose output could not be saved) or a known amount (Exa answering with a shape we no longer parse). The dispatcher bills it from the error exactly as it bills a successful result.

**A waiting call has its own state.** `awaiting_decision` is the delivery state of a parked call. Only a decision or its expiry moves it, and `moveToolDelivery` never selects it, so the stale-claim recovery cannot match a waiting approval. The `notExists` guards that kept recovery away from waiting calls are gone.

**`resolved` is gone** from the confirmation machine and the schema.

**A tool's gate lives in its declaration.** The capability gate map is read from `TOOL_DECLARATIONS`, so a new tool carries its gate or does not compile. Declarations carry no display label: the chat names tools from its own activity catalog.

## Why

- Recording the intent first is the only order that survives a kill at any point. Tagging the provider session covers the one step where the id is not yet known.
- One usage key per Browserbase id makes billing idempotent across the handler, the claim race and the sweep without a lease on billing itself.
- Billing a page read through the browser lifecycle, not through its tool result, closes the gap between the browser being released and the result being stored.

## Consequences

- A failed page read now costs the one-minute minimum (0.2 cents), and a read under a minute costs the minimum too. With credits rounded once per session ([0031](0031-round-once-per-session.md)), a page read raises a session's charge by at most one credit; five of them add one credit in total.
- A browser left by a killed process runs for at most the ten-minute candidate lease plus one sweep, and is billed for that time, capped at one hour.
- The tool result of `browse_page` no longer carries a vendor cost; the dispatcher bills nothing for it, and its `tool:call_complete` event reports 0 credits, like `browse_open` and `browse_close`.
- Saved sign-in contexts are not covered by candidates. A context costs storage, not browser time, and an orphan from a killed open is never used again.
- Adding a gated tool means giving its declaration a `gate`; a renderer and activity phrases are still separate entries in the chat feature.
