# Tests prove behaviour: real Postgres, real modules, no source text

- **Status:** Accepted
- **Date:** June 2026, extended November 2026

## Context

Provisioning, billing and state transitions depend on real database behaviour: transactions, locks and constraints.

An audit in November 2026 found three ways tests passed while the code was wrong:

- Unit tests matched regular expressions against source files. They failed on a harmless reformat and passed when the code under the matched text was broken.
- Integration tests replaced internal modules with `vi.mock`. A mock keyed to a file path stops applying, silently, when the function moves, and the layering work had just moved many files. Two files faked the database itself, so no test could see a broken constraint or a query that ignored the workspace.
- Unit tests stub modules by specifier in a loader hook. A stub whose specifier no import asks for any more still reads as if it isolated something.

## Decision

Database behaviour is tested against real Postgres in Docker, reached through Neon's WebSocket proxy. That is the same `@neondatabase/serverless` driver path as production. `pnpm test:integration:docker` starts the stack, applies the real migrations, runs the suite and removes the stack. See [`tests/integration/README.md`](../../tests/integration/README.md).

An integration test imports `db` from `@/db`, which already points at the test database. It never mocks `@/db`.

An integration test runs every app module for real. It replaces only modules on this list. The `INTEGRATION_MOCKS` selectors in [`eslint-rules/restricted-syntax.mjs`](../../eslint-rules/restricted-syntax.mjs) fail on any `@/` module that is not in `INTEGRATION_SEAMS`, the full list:

- Configuration, operator pricing and the signed-in browser session: `@/lib/env`, `@/features/billing/pricing-config` and `@/lib/auth`, only through `envWith`, `pricingWith` and `signedInAs` in [`tests/integration/helpers/seams.ts`](../../tests/integration/helpers/seams.ts), so each is faked one way everywhere.
- Provider clients and telemetry: the Anthropic client, Stripe, Composio, the MCP proxy, Browserbase, the AI Gateway wrappers, Google Drive import, PostHog analytics and error capture. Each is a thin wrapper over a network call.

Realtime publish and notifications write rows, so tests read those rows instead of mocking the writer.

A unit test checks what code does: it calls a function, renders a component, or runs a lint rule over a sample. It never reads a file under `src/` as text. The lint rule `SOURCE_TEXT_IN_TESTS` fails on a read call that names a `src/` path. Two kinds of read stay: the loaders that compile a `src/` module before running it (`tests/support/load-tsx.mjs`), and `tests/theme/globals-css.mjs`, which feeds the real stylesheet to the production theme parser. A rule that spans the whole source tree, such as "no code reads `process.env` directly", is a lint rule. A rule about one value, such as "every chat event kind has a parser", is a type.

Unit tests stay `.mjs` files that the compiler does not check.

## Why

We rejected PGlite because it is single-connection. The provisioning code uses `pg_advisory_xact_lock` to serialize concurrent first logins, and that race needs two real connections that can block each other. PGlite would give false confidence on the scenario that matters most.

The code standard bans [mocking the unit under test](../spec/01-code-standard.md#8-tests). An internal mock usually mocks part of it: the budget, the grounding, the caller resolution. Running them for real costs a few seeded rows.

The env and auth seams go through one helper because the two had nine different hand-written shapes, and a change to the session object had to be made in each.

We measured type-checking the unit tests with `checkJs`. Strict settings report 5,264 errors in 382 of 451 files. Loose settings, without implicit-any and null checks, still report 1,635 errors in 242 files. Most come from hand-written stubs passed to the loaders, which are shaped for one test, not for the real module's type. Converting them is a project of its own. A renamed export already fails the run at once, because Node checks named imports when it links a module, and a stub nobody asks for is found by tracing the loader hooks (see Consequences).

## Consequences

- The suite needs Docker. Use targeted unit tests while working.
- The default stack binds fixed ports, and two runs at once collide and fail with false errors. For parallel runs, set `TEST_DATABASE_URL` and `TEST_WS_PROXY` to your own stack.
- Never point the tests at production.
- Do not replace this with a mock or an in-process database.
- A new provider wrapper joins the integration allowlist in `eslint-rules/restricted-syntax.mjs` with a one-line reason. An app module never does: seed the rows it reads.
- A test that cannot reach a branch with real state may replace one module and say why in a suppression comment. Three do: `session-send.test.ts` pauses the real grounding read between claim and post, `stale-session-sweep.test.ts` stands in for a database outage, and `tool-dispatch.test.ts` makes the provider-free library tools configurable to exercise the per-tool Ask gate.
- The source-text rule sees a `src/` path written into the read call. A read through a variable passes it, so review still checks for the pattern.
- To find dead loader stubs, run the unit suite with a preload that records every specifier the stubs are asked for, then list stub specifiers nobody asked for. The November 2026 sweep removed 56.
