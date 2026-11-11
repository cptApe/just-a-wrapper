# Grant top-ups on the database clock

- **Status:** Accepted; extended to the whole ledger by [0032](0032-one-ledger-clock-and-explicit-payment-records.md)
- **Date:** November 2026

## Context

A balance read compares each grant's issue time with the database's `now()`. Top-up grants used the application's `new Date()`.

## Decision

A top-up grant takes its issue time from the transaction's database clock. [Decision 0032](0032-one-ledger-clock-and-explicit-payment-records.md) applies the same rule to every grant, debt and balance read: `issueCreditGrant` takes `issuedAt: 'now'`, which resolves to `ledger.now`, read from the database when the ledger is locked.

## Why

A grant stamped by the app clock can sit in the future of the database clock, which hides paid credits from every balance read. A person who has just paid would see no credits.

## Consequences

- The transaction that grants the credits also reports the new balance, and that balance includes them.
- [`billing-topup-grants.test.ts`](../../tests/integration/billing-topup-grants.test.ts) and [`billing-ledger.test.ts`](../../tests/integration/billing-ledger.test.ts) cover this behaviour.
- Yearly plans store future-dated monthly grants. Only those take a `Date`, and it must be later than `ledger.now`.
