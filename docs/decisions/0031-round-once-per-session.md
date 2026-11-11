# Round credits once per session, not per model request

- **Status:** Accepted
- **Date:** November 2026

## Context

Every usage event used to charge `ceil(cost)` on its own. A Fast request that cost 0.06 cents charged a whole credit, the same as a 1-cent Balanced request. A Fast session of many short tool-loop requests paid 10 to 20 times its vendor cost, so "API cost, no markup" and the tier multipliers (Fast 0.05x, Expert 2x) were false for short requests. Runtime had its own high-water rounding, and the provider's list-cost reconciliation could only add to the per-request charge, never correct it.

Dictation wrote the ledger through a second path with no vendor cost, no settlement row and no record at all with billing off. Chat titles were a model call nobody recorded.

## Decision

A session keeps one exact running total of its customer-billable vendor cost, `session.vendor_cost_cents`, next to `session.credits_consumed`. Every usage event that belongs to a customer-paid session (model request, runtime, tool call, media, read-aloud) charges

`max(0, creditsForVendorCents(vendor_cost_cents after this event) - credits_consumed before this event)`

under the session row lock. `recordUsage` in [`record-usage.ts`](../../src/features/billing/api/record-usage.ts) is the one recorder and applies the rule. A usage row can therefore carry `credits_delta = 0` with a positive cost. A request that costs nothing is still recorded.

- **Runtime** joins the total: new container seconds convert to exact cents at 8 cents an hour. `session.container_seconds` stays the seconds high-water mark.
- **Provider snapshots** add the gap between the cumulative list cost and the model and runtime cost already recorded, and the same rule charges it.
- **Usage with no session** (dictation) goes through the same recorder with no session and rounds once per event. It has the same pending-then-complete settlement and the same sweep (`reconcile-pending-billing.ts`).
- **Platform-paid usage** (billing off, and chat titles always) records the exact vendor cost, charges nothing and stays out of the session total, so turning billing on later never bills it.
- **Raw spans stay in `model_usage_observation`.** A snapshot can bill a span's tokens before the span arrives. Summing raw spans against what was recorded is what lets the late span charge only the uncovered part, so the table stays; its per-span `credits` column went away.
- **The dictation pre-check** estimates from the uploaded file's size divided by the lowest recorder bitrate, never from a duration the browser states.
- **Existing sessions** start their total at the recorded customer-paid vendor cost, capped at the credits already charged. History stays settled at what was charged, and the rounding those sessions already paid absorbs new cost before another credit is due. So no event costs more than it did under the old rule, including the first runtime or snapshot event after the migration.

## Why

Rounding once per session makes the tier multipliers and "no markup" true at every request size, and it is never more than the old per-request ceil. One total and one recorder replace three rounding schemes (per span, runtime high-water, list cost) and two ledger write paths.

## Consequences

- `MIN_TURN_CREDITS` stays as the pre-turn gate. A new session still pays its first credit on its first request.
- A new metered path calls `accrue` in [`accrue.ts`](../../src/features/billing/api/accrue.ts) with a recorder that uses `recordSessionUsage` or `recordWorkspaceUsage`. Do not compute credits for one event in isolation. `accrue` owns three rules for every path: a transient database failure retries the whole accrual; usage on a session the app does not know is logged and skipped, never thrown; and once the charge is recorded, a failed settlement is reported while the result still says billed, because the pending-settlement sweep finishes it. Read-aloud and paid tools follow the same rules as model spans, so a database conflict can no longer cost a person audio they paid for.
- `usage_event.usage_key` is the idempotency key for every kind of event; prefix new kinds (`tool:`, `tts:`, `voice:`, `title:`, `runtime:`).
- The usage log shows chat titles as platform-paid rows.
- Sessions that existed before this change do not satisfy `credits_consumed = creditsForVendorCents(vendor_cost_cents)` until their next charge catches up; the invariant is checked only for sessions charged under this rule.
