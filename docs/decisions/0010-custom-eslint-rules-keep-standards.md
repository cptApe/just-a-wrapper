# Custom ESLint rules enforce the standards

- **Status:** Accepted
- **Date:** April 2026, extended through November 2026

## Context

A standard written only in a document is easy to miss. We want a mistake to fail at the moment it is made.

## Decision

When a tool can check a rule, we write it as a local ESLint rule in [`eslint-rules/`](../../eslint-rules/index.mjs) and run it in `pnpm lint`. The rules cover silent catches, bare throws, stray `console` calls, raw colours, feature boundaries, direct auth session reads, raw `process.env` reads, server actions without a boundary, request context on entry points, lifecycle writes outside their owner, raw forms, server data loaded in effects, raw `Intl` formatting, import paths, journal-style comments and suppressions without a reason. [`eslint-rules/index.mjs`](../../eslint-rules/index.mjs) lists them all.

ESLint owns linting. Biome owns formatting and import sorting.

## Why

The split exists because the custom rules need ESLint's plugin API, which Biome does not offer, and Biome formats much faster than Prettier. See [03-patterns.md §16](../spec/03-patterns.md#16-linting--formatting).

Every suppression must state its reason in the same comment, so an exception stays visible.

## Consequences

- A new standard should arrive with a rule when a rule can express it.
- `pnpm lint` uses ESLint's cache. `eslint.config.mjs` hashes `eslint-rules/` into its settings, so editing a rule re-lints every file.
- Do not delete a rule to get past a failure. Fix the code or suppress it with a reason.
