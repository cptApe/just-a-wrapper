---
name: run-locally
description: Install, configure, start and check the app locally. Read before starting a server.
---

# Run the app locally

1. Use Node 22.9 or newer and pnpm 10. Run `pnpm install --frozen-lockfile`.
2. Run `pnpm run setup` in a terminal. It asks for a database URL and an Anthropic API key, writes `.env`, applies migrations and seeds agents, which writes to the Anthropic account behind that key. `pnpm setup` is a different command, built into pnpm. Never print or commit secrets.
3. To change `.env` by hand later, use `.env.example` and README.md for the optional providers.
4. Start `pnpm dev`. The port resolver uses `.dev-port` if present, otherwise 3000, and selects the next free port when occupied. Read the startup output for the actual address.
5. Check `curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:<port>/`. Expect 200 or a sign-in redirect.

## Local Postgres instead of Neon

The app uses Neon's driver, which talks to the database over WebSocket. `docker-compose.dev.yml` runs Postgres 16 behind Neon's WebSocket proxy, so no Neon account is needed.

1. Run `docker compose -f docker-compose.dev.yml up -d`.
2. Put these two lines in `.env`:

   ```
   DATABASE_URL=postgres://dev:dev@localhost:55434/agentcore
   DATABASE_WS_PROXY=localhost:54446/v1
   ```

3. Run `pnpm run setup` or `pnpm db:migrate`. Both keep the `DATABASE_URL` already in `.env`.

`DATABASE_WS_PROXY` turns database TLS off, so the app refuses to start with it in production. Leave `DATABASE_URL_UNPOOLED` unset, or point it at the same local database: migrations prefer it. `docker compose -f docker-compose.dev.yml down -v` deletes the local data.

## Tests

Run integration tests against the isolated Docker stack with `pnpm test:integration:docker`, never a production database. Do not build or delete `.next` while a server uses it. Localhost cookies are shared across ports; use separate browser profiles when testing multiple instances.
