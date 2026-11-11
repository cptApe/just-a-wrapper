# One ledger clock and explicit payment records

- **Status:** Accepted
- **Date:** November 2026

## Context

The credit ledger mixed the app clock and the database clock. Debt subtypes lived in `source_ref` prefixes. A manual top-up trusted the browser's clock to decide whether a new charge was safe. Every usage settlement could call Stripe. `processed_webhook_event` held receipts, event claims, made-up event ids and grant guards under hand-built keys.

## Decision

- **One clock.** `lockLedger` reads `now()` once and puts it on the `LockedLedger`. Every ledger decision uses `ledger.now` or `now()` in SQL. `issueCreditGrant` takes `issuedAt: 'now' | Date`, and a `Date` must be later than `ledger.now`, so the app clock cannot stamp spendable credit. No ledger function takes a `now` parameter.
- **One writer.** Every `credit_grant` insert and update goes through `credit-grant-transitions.ts`, and each function there takes a `LockedLedger`. The lint rule allows writes to the table nowhere else.
- **Debt has a kind.** `credit_grant.debt_kind` is `usage`, `hold`, `refund` or `restored`, and `parent_grant_id` links a row to the grant it derives from. CHECK constraints tie `source = 'debt'` to a kind and a hold to a parent. `source_ref` is only the idempotency key. Debt keeps `consumed = 2 * amount`: the balance stays one sum of `amount - consumed`, and a CHECK keeps debt `consumed` between `amount` and `2 * amount`.
- **Derived credit links by parent.** A refund remainder or a restored live credit names its purchase. A credit that restores refund debt names that refund debt row. The reversal math reads these links instead of prefixes.
- **Manual top-ups live on the server.** `manual_topup_attempt` is keyed by workspace and attempt key and stamped by the database clock. The browser sends only the key. Inside Stripe's idempotency window a retry replays the same create; past it, the server looks the payment up and never creates a charge.
- **Automatic top-ups.** A partial unique index allows one open attempt per workspace. `charging` is the named state for a frozen card. Settlement calls `maybeAutoTopup`, which decides from the database, starts at most one payment, reports its own errors and never throws. The `payment_intent` webhook and the billing cron finish open attempts.
- **Stripe bookkeeping.** The `credit_grant` unique index on `(workspace_id, source_ref)` is the only de-duplication for top-ups and invoices. Handlers take the Stripe object, not a made-up event. `processed_webhook_event` keeps one payload-free receipt per real Stripe event id, and the billing cron prunes receipts older than 90 days, except the newest. The same job prunes Anthropic receipts and finished Composio deliveries after 90 days. Turn-analytics claims are not webhook receipts: they live in `session_turn_claim`.
- **A payment with no workspace** is refunded and reported as `unmapped-customer-payment`, by both the top-up and the invoice handlers.
- **Welcome credits once per person.** `welcome_credit_grant` has the user id as its primary key and is written in the same transaction as the grant. It outlives every workspace and membership.

## Why

Two clocks decided which grants existed, so fresh credits could hide from one reader and appear to another. A prefix is not a schema: a new source reference could change balance math by accident, and `LIKE` treats `_` in Stripe ids as a wildcard. A browser clock a day off could cause a second charge or block every purchase. A Stripe outage stopped usage from settling. Two de-duplication systems for one top-up meant a reader had to know both, and a made-up event id once blocked a real redelivery.

## Consequences

- The migration backfills `debt_kind` and `parent_grant_id` from the old prefixes, rewrites legacy `stripe:<event>:<month>` plan grants to `plan-invoice:<invoice>:<month>`, keeps only Stripe receipts, moves card-frozen attempts to `charging` and records past welcome grants. The 0009 block of [`migrations.test.ts`](../../tests/integration/migrations.test.ts) proves it on old-shaped rows.
- A legacy plan grant whose event row had no payload keeps its old source reference. No current code writes or reads that form.
- A browser key stored before this change is new to the server on its next use. If that key's first charge is more than a day old, Stripe has forgotten it and a retry creates a new charge. This lasts only until such keys are used once. The owner accepted this gap rather than pay one Stripe search per purchase.
- Tests that need a balance at a future instant read it with `balanceAt` in `tests/integration/helpers/billing-ledger.ts`; production reads only at the database clock.
