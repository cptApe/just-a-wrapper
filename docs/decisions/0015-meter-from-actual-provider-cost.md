# Meter usage from the provider's actual cost

- **Status:** Accepted
- **Date:** July 2026

## Context

Every agent turn and tool call spends vendor money. We need to turn that spending into credits accurately.

## Decision

When a provider states the real cost, we bill that figure. Today that means `usage.list_cost` for model usage, `costDollars.total` for Exa and the recorded Gateway cost for media. Browser time has no returned cost, so it is measured from session seconds and the vendor's rate.

For media, the preflight estimate is used only when the cost lookup fails. That recovery is reported, and paid output is still delivered ([`resolve-media-cost.ts`](../../src/features/billing/api/resolve-media-cost.ts)). An Exa answer without `costDollars.total` bills nothing and is reported the same way ([`exa-request.ts`](../../src/features/tools/lib/exa-request.ts)).

## Why

Estimate tables drift from provider prices. They also block per-option features such as quality tiers behind table updates, and they force padding that overcharges people. Before July 2026 generation tools billed from pinned tables even though the vendor returned the real cost.

## Consequences

- A new paid tool must use the returned cost if the provider gives one. Verify that against the provider's docs.
- Tool results are delivered before billing settles, and `usage_event` uniqueness keeps a retry from charging twice.
- Do not add a new per-tier price table in place of a returned figure.
