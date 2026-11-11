# Throw typed errors and never swallow them

- **Status:** Accepted
- **Date:** April 2026, extended July 2026

## Context

The agent runs in the background across several vendors. When something fails, a person or a coding agent needs the cause from the logs. A `catch` that returns a default hides the only evidence.

## Decision

Every throw in `src/` is an `AppError` subclass from [`errors.ts`](../../src/lib/errors.ts) with a stable code, structured context and the native cause.

A `catch` is allowed only to do one of three things: turn the error into a response or UI state at a boundary, translate a foreign error and rethrow, or run a recovery whose reason is a named product rule.

See the [code standard](../spec/01-code-standard.md#3-errors) and [04-observability.md](../spec/04-observability.md#4-no-silent-failures--enforced).

## Why

Log-and-swallow is the default way errors disappear, so the first custom lint rule in the repo bans it. The observability spec states the goal: a coding agent can read the logs and traces, find the cause and fix it without human help. In July 2026 we converted the remaining bare throws and enabled `no-bare-error-throw`.

## Consequences

- `no-silent-catch` and `no-bare-error-throw` fail the lint run. A logger call alone does not satisfy the rule.
- Expected outcomes are values, and only mutations called from a form or button return `ActionState`, through `runAction` ([0026](0026-one-server-action-boundary.md)). Everything else throws.
- Do not add a `?? default` across sources of truth or a "try A, then B" cascade. See [0009](0009-capabilities-resolved-once.md).
