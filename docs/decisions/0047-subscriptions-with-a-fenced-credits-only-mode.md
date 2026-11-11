# Subscriptions are the billing mode; credits only is a fenced add-on

- **Status:** Accepted. Supersedes [0018](0018-sell-credits-only.md).
- **Date:** November 2026

## Context

Decision 0018 made one deployment sell credits only and removed the plan picker, plan checkout and plan changes. The open-source app sells monthly plans first. Credits only exists for one deployment, and a fork should be able to delete it.

## Decision

- **One billing mode, resolved in one place.** `billingCapability()` in [`runtime-capabilities.ts`](../../src/lib/runtime-capabilities.ts) answers `off` (no Stripe key), or `stripe` with a mode: `subscriptions` or `credits_only`. Code reads the mode's rules through [`billing-mode-rules.ts`](../../src/features/billing/lib/billing-mode-rules.ts) (`sellsPlans`, `noPlanLimits`) and never names a mode. A fresh fork with Stripe keys sells subscriptions.
- **The mode is a deployment setting.** [`src/lib/deployment-settings`](../../src/lib/deployment-settings) is a typed store: one append-only table, `deployment_setting`, where the newest row per key is the value and the older rows are the audit. The env var (`BILLING_MODE`) is the base value; a stored value wins. The admin console writes through one server action, `updateDeploymentSettingAction`, behind the same gate as the console. Production has no admin console, so it sets the mode through env.
- **Subscriptions are complete.** A person picks a plan, an interval and a monthly package in the plan dialog (`#plans`, the shared modal family). A first plan goes through Stripe Checkout in subscription mode. A bigger plan, a bigger package or monthly to yearly starts now: the dialog shows Stripe's exact proration from `invoices.createPreview`, and the server charges it with `proration_behavior: always_invoice` and `payment_behavior: error_if_incomplete`, so a declined card changes nothing. A smaller change waits for the renewal as a subscription schedule phase and charges nothing now. Cancel sets `cancel_at_period_end`; resume clears it. The paid invoice, through the webhook, records the plan and grants its credits, as before (decision 0032).
- **A workspace without a plan.** In subscription mode it has `NO_PLAN_LIMITS` (one chat, no schedules, one member) and can buy credits once. A refusal at a limit says a bigger plan raises it and offers "See plans". In credits-only mode it has the top plan's limits and refusals offer nothing, as before.
- **Credits only is one folder.** [`src/features/billing/credits-only`](../../src/features/billing/credits-only) holds its rules, imported only by `billing-mode-rules.ts`. In credits-only mode the plan dialog does not open, plan routes refuse, `pnpm seed:stripe` creates no plan price and archives none, the admin overview skips the plan catalog check, and `pnpm validate:config` skips the plan checks. Existing subscribers keep a read-only plan row, auto top-up, the Stripe portal and every webhook handler.
- **No upgrade page.** `/upgrade` still redirects to the app. Lint group `NO_UPGRADE_PAGE` keeps it from coming back; plan copy is allowed again.

## Why

Plans were the product before 0018, and the server side for them (invoice grants, proration, the schedule of future buckets) never left. Putting the mode behind one capability keeps the two modes from drifting apart in the code, and the rules object means the compiler finds every place that would change. The append-only table gives the audit for free and needs no update path.

## Consequences

- Production must set `BILLING_MODE=credits_only` before it runs this code, or every workspace without a plan drops to the subscription-mode limits.
- Changing `MARGIN_PERCENT` in subscription mode needs `pnpm seed:stripe`: plan prices are compared by amount again, and the seed moves each lookup key to a new price. Existing subscribers keep the price they signed up at.
- The Stripe portal keeps plan switching off ([deploy guide](../deploy.md)); plans change in the app, where the ledger rules apply.
- Adding a deployment setting is one entry in `DEPLOYMENT_SETTINGS` in [`registry.ts`](../../src/lib/deployment-settings/registry.ts) plus its env key in `src/lib/env.ts` and the env registry; the store, the action and the audit need no change.

### Removing credits-only mode from a fork

1. Delete `src/features/billing/credits-only/`.
2. Remove `'credits_only'` from `BILLING_MODES` in `src/lib/deployment-settings/registry.ts` and its line in `RULES` in `src/features/billing/lib/billing-mode-rules.ts`, with its import.
3. Remove the "Credits only" label in `src/features/admin/settings/components/billing-mode-admin.tsx`.
4. Run `pnpm verify`. A stored `credits_only` row is skipped and reported, and env decides.
