# Local Postgres through the Neon proxy

- **Status:** Accepted.
- **Date:** November 2026

## Context

The app talks to the database through `@neondatabase/serverless` over WebSocket, because Better Auth and workspace provisioning need real transactions. That driver reaches only Neon, so trying the app meant making a Neon account first. The integration tests already run the same driver against plain Postgres through Neon's WebSocket proxy (`docker-compose.test.yml`), but the app and `pnpm db:migrate` had no way to do the same.

## Decision

One optional setting, `DATABASE_WS_PROXY`, points the driver at a local proxy (`host:port/path`, for example `localhost:54446/v1`).

- **One function sets it up.** `applyLocalDatabaseProxy` in `src/db/local-proxy.ts` sets `wsProxy`, turns off secure WebSocket and pipelining, and leaves the driver alone when the setting is empty. `src/db/index.ts` and `scripts/db-migrate.ts` both call it, so the app and migrations reach the same database the same way.
- **The rule lives with the other deployment rules.** `localDatabaseProxy` in `src/lib/env-schema.ts` checks the format and refuses the setting on a production deployment, using the same test as the admin and dev route flags. The proxy link has no TLS. `src/lib/env.ts` runs the check when the server starts.
- **`docker-compose.dev.yml`** runs Postgres 16 and the proxy on ports 55434 and 54446, with a named volume, apart from the test stack.

We keep one driver. Switching to `pg` for local work would give two code paths with different transaction behaviour, and bugs would hide in the one production does not use.

## Consequences

- A contributor needs Docker and two `.env` lines instead of a Neon account.
- The admin environment page shows the setting in its Developer group. `.env.example` lists it under Core.
- A production deployment with `DATABASE_WS_PROXY` set fails at startup instead of sending database traffic without TLS.
