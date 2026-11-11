---
name: customize-pricing
description: Change the billing mode, plan economics, credit packages, margin, credit lifetimes, auto top-up defaults, and Stripe test catalog values from the canonical pricing configuration.
---

# Customize pricing

Read `src/features/billing/pricing-config.ts`, `src/features/billing/catalog.ts`, and `scripts/seed-stripe.ts` before editing. Every operator-set commercial value lives in `pricing-config.ts`. Nothing else in the repo may hold a price.

## The billing mode comes first

A deployment with Stripe sells in one of two modes, read through `billingCapability()` (decision 0047). `subscriptions`, the default, sells monthly plans in the in-app plan dialog and one-time credits beside them. `credits_only` sells one-time credits and no plans. The mode is the `BILLING_MODE` env var, or the admin console's Pricing page where it runs; a stored choice wins. Ask which mode the operator runs before changing a plan number: in credits-only mode plan prices are seeded and checked by nobody.

## The model, before you touch a number

One credit is one cent of vendor cost, the same credit on every plan. `MARGIN_PERCENT` turns that cost into a price. The two plans differ by the smallest credit package they start at and by their limits, never by what a credit costs. Stripe holds one recurring price per plan, billing period and credit package, always at quantity one (`buildIntendedCatalog` in `src/features/billing/lib/stripe-plan.ts`). Bought credits have no catalog price: each top-up charges its own total. Adding a package therefore adds prices, so run `pnpm seed:stripe` after the change.

`src/features/billing/lib/credit-math.ts` is the COST side: what Anthropic, Vercel AI Gateway, and Browserbase charge. Never edit it to reprice the product. Change `MARGIN_PERCENT` instead.

## The knobs

- `MARGIN_PERCENT` is the only price knob. A whole number from 0 to 95. Zero means a customer gets one credit for every cent paid. The block price, every plan price, and every top-up price derive from it.
- `CREDIT_BLOCK` is the step of the credit packages. Every package and every plan minimum must be a positive multiple of it. One-time credit purchases are the exception.
- `CREDIT_PACKAGES` is the ordered list of monthly credit amounts a plan can carry, and the packages auto top-up offers. Smallest first, no repeats. The plan dialog offers each plan the packages at or above its `minCredits`.
- `STARTER_PACK_CREDITS` is the smallest one-time purchase and how far the credit stepper moves. A customer can type any whole number at or above it, and pays for exactly that many credits with nothing rounded up. One-time purchases are charged as one inline Stripe amount, so they need no Stripe price and never appear in auto top-up. Keep it smaller than the first entry in `CREDIT_PACKAGES`. At 0 percent margin, 500 credits cost $5.00; changing the margin changes that price.
- `STRIPE_MAX_CHARGE_CENTS` is not a product limit and not a knob. It is the largest single charge Stripe takes on every payment path, 99,999,999 cents. The server refuses anything above it.
- `PLANS` holds each plan's name, description, `minCredits`, and `limits` (`chatsAtOnce`, `scheduledTasks`, `members`, where `null` means no limit). Advertise a limit only where it is enforced. `NO_PLAN_LIMITS` is what a workspace without a plan may do in subscription mode (one chat, no schedules, one member as shipped); a plan lifts it. In credits-only mode a workspace without a plan gets the top plan's limits instead (`src/features/billing/credits-only/rules.ts`). `TOP_PLAN_TIER` is the plan a limit refusal never points past.
- `YEARLY_CHARGED_MONTHS` and `YEARLY_DELIVERED_MONTHS` define the annual discount without a floating-point percentage.
- `PLAN_CREDITS_ROLL_OVER` and `ROLLOVER_EXPIRY_MONTHS` decide what happens to unused monthly credits.
- `TOPUP_CREDIT_EXPIRY_MONTHS` is how long bought credits last.
- `WELCOME_CREDITS` is what a new account gets once, before it buys anything. Zero, the shipped value, means paid from the first message. Deployments without Stripe never check a balance, so this value does not affect them.
- `AUTO_TOPUP` holds `thresholdCredits` (a kit default, not a customer setting), `defaultCredits` (must be one of `CREDIT_PACKAGES`), and `failedCooldownHours`.
- `VENDOR_BILLS`, `COST_SCALES`, and `COST_ASSUMPTIONS` describe the services the product runs on. Every one of them is paid: each has a free tier that covers a small app and a bill that grows with use. `COST_SCALES` is the three sizes of business the page reads the bills at, smallest first; `VENDOR_BILLS` gives every service a whole-cent monthly estimate at each of those scales; `COST_ASSUMPTIONS` says what one paying customer is assumed to do in a month, so an estimate can be argued with. Nothing bills from this list; the admin Pricing page adds it up and works out how many entry-plan subscriptions cover it. Replace the shipped estimates with the operator's real bills.

Keep money arithmetic integer-based. Do not duplicate a price in a component, an API handler, the Stripe script, or a doc. The keys `pro` and `max` are application identifiers, not display labels: rename the display `name` freely, but changing a key means tracing types, lookup keys, billing APIs, tests, and existing Stripe objects.

## Rename with care

`WorkspacePlan` is `'none' | 'pro' | 'max'` and the database column carries those strings. Product copy never says "Free", "Business", or "ladder". In subscription mode a limit refusal states the limit, adds "A bigger plan raises this limit." below the top plan, and the app offers the plan dialog. In credits-only mode a refusal states the limit and points at nothing.

## Check the generated surfaces

Everything on `/admin/pricing` imports the configuration and updates at build time. Do not hand-edit its numbers. After a change, load `/admin/pricing` and read the margin rows, the plan table, the charge rows, and the vendor bill table before calling the pricing safe.

## Reconcile Stripe deliberately

Run `STRIPE_SECRET_KEY= pnpm seed:stripe` for a guaranteed dry-run plan, even if `.env` holds a test key. After reviewing the output, run `pnpm seed:stripe` with an `sk_test_` key only when the operator authorizes test-mode Stripe changes. The script refuses live keys unless you pass `--live` with an `sk_live_` key, which the operator must authorize separately. It creates deterministic products named after `NEXT_PUBLIC_BRAND_NAME` (a live run refuses without it), and replaces a price when a current lookup key has a changed amount. It transfers that lookup key and deactivates the replaced price.

Top-ups are inline-priced, so a change to `MARGIN_PERCENT` or `STARTER_PACK_CREDITS` takes effect on the next one-time purchase with no reseed. In subscription mode plans are sold at their Stripe price, so a change to `MARGIN_PERCENT`, `PLANS` or `CREDIT_PACKAGES` needs a reseed; existing subscribers keep the amount they signed up at, because the seed moves only the lookup key. The admin check compares currency, amount, product, interval and metadata. In credits-only mode the seed creates no plan price and archives none, and the admin check is skipped. Existing Stripe products keep their current name, description, and metadata because the script returns them without an update. If product copy changed, report the retained Stripe objects and ask for explicit authorization before updating them in test mode.

Do not claim the plan catalog is reconciled until the authorized test-mode seed output proves it.

## Verify

```bash
pnpm validate:config
node --import ./scripts/register-aliases.mjs --test tests/billing/pricing.test.mjs tests/billing/plans.test.mjs tests/billing/stripe-setup.test.mjs tests/billing/auto-topup.test.mjs tests/configuration/config-validation.test.mjs
STRIPE_SECRET_KEY= pnpm seed:stripe
pnpm verify
```

`pnpm validate:config` checks the pricing invariants directly: the margin is a whole number from 0 to 95, the credit block is positive, every package is a positive multiple of it, packages are unique and ascending, in subscription mode every plan minimum is a block multiple with a package big enough to buy, welcome credits are not negative, the auto top-up amount is one of the packages, cost scales are ascending, and no vendor bill is negative at any scale. Read its failures literally; each one names the constant and the file.

Then reload `/admin/pricing` and confirm it says "Stripe matches your prices" (subscription mode) or "Credits only: top-ups need no Stripe prices".

A package-list change also requires updating `AUTO_TOPUP.defaultCredits` and the workspace schema default if the old default is removed; do not backfill existing subscriptions. Historical migration tests pin their original literals, not the current config.
