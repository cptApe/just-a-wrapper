# DB-integration tests

These run the provisioning code against a **real Postgres**, reached through the
Neon WebSocket proxy — the same `@neondatabase/serverless` driver path used in
production. That gives genuine separate backend connections, real transactions,
real `pg_advisory_xact_lock`, and the actual CHECK/FK/unique constraints from the
committed migrations.

## Why not PGlite

PGlite is single-connection (its v0.4 multiplexing serializes clients over one
backend). The provisioning fix exists to prevent a **concurrent** first-login
race using an advisory lock — which requires two real connections that can block
on each other. PGlite cannot reproduce that, so it would give false confidence on
the one scenario that matters most. A containerized Postgres + wsproxy can.

## Run locally

```bash
# 1. start Postgres + the Neon wsproxy (ports 55432 / 54444)
docker compose -f docker-compose.test.yml up -d --wait

# 2. run the suite (applies the real migrations, then truncates between tests)
pnpm test:integration

# 3. tear down
docker compose -f docker-compose.test.yml down -v
```

`pnpm test:integration:docker` does all three in one shot.

## How the files are laid out

One file per behaviour area, named for the area: `workspace-access`, `workspace-provisioning`,
`account-deletion`, `privacy`, the `billing-*` and `metering-*` files, `session-*`, `task-*`,
`files-*`, `skills` and so on. A bug fix adds a case to its area file. `migrations.test.ts` holds one
block per migration that production has not applied yet, each run on rows shaped like the old data.

`applyMigrations` builds the schema from the committed migrations once and records a fingerprint of
the files and of the resulting schema. A later file with the same fingerprint and an unchanged schema
only truncates every table; a file that changed the schema (a migration test, a renamed table left
behind) makes the next one rebuild it.

## Connection config

`helpers/test-db.ts` points the serverless driver at the local wsproxy
(`useSecureWebSocket = false`, `wsProxy → localhost:54444/v1`). The `/v1` path is
required by the wsproxy image. Override with `TEST_DATABASE_URL` / `TEST_WS_PROXY`.

These tests are intentionally **excluded from `pnpm verify` and the Stop hook**
(they need Docker and are slow). CI runs them in a dedicated job.

## What a test may mock

App code runs for real against the test database: import `db` from `@/db`, seed the
rows the code reads, and assert on rows. A test replaces only the seams listed in
`INTEGRATION_SEAMS` in `eslint-rules/restricted-syntax.mjs` (provider clients,
telemetry, configuration, pricing and the signed-in session), and lint fails on any other
`@/` mock. Configuration, pricing and the session go through `helpers/seams.ts`:

```ts
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, { CRON_SECRET: 'test' }),
);
vi.mock('@/lib/auth', async () => (await import('./helpers/seams')).signedInAs(() => state.viewer));
```

Background work scheduled with `after()` is captured by mocking `next/server` and
run when the test needs it. See [decision 0012](../../docs/decisions/0012-integration-tests-on-real-postgres.md).

## Stalled collection

A completed realtime file does not establish that a later stall is a database
lock. Check Postgres activity and identify the worker's current test module before
changing stream cleanup. Tests using the real auth flow retain real auth and
Postgres; only tests that already supply authorization stub that boundary.
