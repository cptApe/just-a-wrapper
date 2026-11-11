# One server action boundary

- **Status:** Accepted
- **Date:** November 2026

## Context

`runAction` was meant to be the one server-action boundary. About ten other actions copied its body by hand: request context, a `try`/`catch` and an `{ ok: false }` result. Each copy had its own rule for what to report, and three actions had their own result types. Other actions threw from `'use server'` files, where production masks the message. Several helpers that take `Headers` were exported from `'use server'` files, which makes them public endpoints.

## Decision

A mutation called from a form or button goes through `runAction` and returns `ActionState`. A read is an API route fetched with `fetchJson`, or a server action wrapped in `withRequestContext` that throws. `runAction` takes an `expected` option that keeps user-fixable errors out of error tracking. The lint rule `just-a-wrapper/require-action-boundary` fails any function exported from a `'use server'` file that calls neither `runAction` nor `withRequestContext`.

## Why

One boundary gives every action the same reporting and the same safe messages. The lint rule means a new action cannot skip it.

## Consequences

- Workspace actions share `workspaceActionBoundary`; preferences and feedback throw `TOOL_INPUT_INVALID` with the copy for the row, and `appErrorMessage` returns it.
- Integration actions keep their domain result types (`ConnectResult`, `IntegrationActionsResult`). Those results carry a status the UI branches on, not an error envelope.
- Helpers that take `Headers` live in modules without the directive. Tests import them from there.
