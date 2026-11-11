# One credit equals one cent, with one margin setting

- **Status:** Accepted
- **Date:** September 2026

## Context

Earlier pricing hid margin in three places: a burn unit worth more than a cent, per-tier retail rates and a 2x media multiplier. Top-ups also carried a 20 percent premium.

## Decision

One credit is one cent of vendor cost, the same credit on every plan. [`MARGIN_PERCENT`](../../src/features/billing/pricing-config.ts) is the only price setting, and every price derives from it. `CENTS_PER_CREDIT` is the cost-side unit and is not a price. `creditsForVendorCents` in [`credit-math.ts`](../../src/features/billing/lib/credit-math.ts) turns a vendor cost in cents into credits for tool calls, media, voice and model cost.

## Why

An operator needs a single place to choose the margin. The admin Pricing page, checkout and the Stripe seed read the same values, so one edit changes them all.

## Consequences

- Run `pnpm validate:config` after changing pricing.
- Do not change `credit-math.ts` or `CENTS_PER_CREDIT` to reprice the product.
- Do not reintroduce per-tier credit rates, a top-up premium or a media multiplier.
- Do not add a second conversion from vendor cost to credits. Call `creditsForVendorCents`.
