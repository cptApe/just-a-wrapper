# Sell Pro and Max subscription plans

- **Status:** Superseded by [0018](0018-sell-credits-only.md)
- **Date:** September 2026

## Context

An August 2026 billing model had Free, Pro and Business tiers, with a free daily credit drip. We reworked it alongside the [single margin](0016-one-credit-one-margin.md).

## Decision

Two plans, Pro and Max. They differed by limits (chats at once, scheduled tasks, members) and by their smallest credit package, never by the price of a credit. The free plan and its drip were replaced by a one-time welcome grant.

## Why

A credit had to mean the same thing on every plan. Free plans also fit poorly, because whoever runs a copy pays every vendor bill.

## Consequences

Superseded in November 2026. Pro and Max remain in [`pricing-config.ts`](../../src/features/billing/pricing-config.ts) for existing subscribers, who keep the amount they signed up at. New customers buy credits only.
