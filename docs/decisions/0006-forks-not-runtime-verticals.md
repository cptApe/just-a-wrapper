# A new niche is a fork, not runtime configuration

- **Status:** Accepted
- **Date:** April 2026, reinforced August 2026

## Context

The same workspace can serve many kinds of business. One way to support this is a per-workspace setting that switches brand, skills and prompts at runtime.

## Decision

One deploy serves one product. A new niche is a fork. The fork changes `content/` (pack, marketing, brand), the system prompt constants, the pricing config and the environment IDs, then redeploys. The `features/` code stays the same. See [02-foundation.md §10](../spec/02-foundation.md#10-vertical-fork-model).

## Why

The spec calls runtime switching an abstraction tax: `vertical_config` tables and branches in the running app. A fork costs a clone and a few files.

We tried a mild version of runtime switching: a vertical stamped on workspaces and skills. We removed those columns in August 2026. All brand strings now come from one module, `src/lib/brand`, fed by configuration ([decision 0048](0048-brand-and-contact-come-from-configuration.md)).

## Consequences

- The [make-it-yours skill](../../.claude/skills/make-it-yours/SKILL.md) can rebrand a copy by editing known files.
- Keep fork-owned values in `content/` and the pricing config.
- Do not add a `vertical` column or a per-workspace brand. Deployment-wide values an operator changes at run time live in the deployment settings store (decision 0047).
