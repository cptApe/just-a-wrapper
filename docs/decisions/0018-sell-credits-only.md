# Sell credits at cost through one top-up dialog

- **Status:** Superseded by [0047](0047-subscriptions-with-a-fenced-credits-only-mode.md). Its rules live on as credits-only mode.
- **Date:** November 2026

## Context

The app had a pricing grid, an upgrade page, a plan picker and plan checkout, next to several separate ways to buy credits.

## Decision

- `MARGIN_PERCENT` is 0, so a customer gets a credit for every cent paid. 500 credits cost $5.
- New customers buy credits only. The upgrade page and plan picker are gone, and `/upgrade` redirects to `/app`.
- A workspace with no plan gets the top plan's limits. A limit refusal states the limit and never points at a plan.
- Every purchase goes through one dialog: the `topup` overlay at the `#topup` hash. A saved card is charged in the dialog, and a new card goes to Stripe Checkout.
- The server validates the amount and computes the price.

## Why

One dialog on the current page replaces several routes and keeps people where they were working. Buying credits unlocks the whole product.

No longer argument for choosing a zero margin was written down. `MARGIN_PERCENT` stays as the setting for any fork that wants one.

## Consequences

- Existing subscribers keep a read-only plan row, auto top-up and the Stripe portal. Keep the Portal's plan switching off ([docs/deploy.md](../deploy.md)).
- Top-ups use an inline price, so changing the margin needs no Stripe reseed.
- Link to purchases with `openOverlay('topup')` or a `#topup` URL. Do not build a second purchase page.
