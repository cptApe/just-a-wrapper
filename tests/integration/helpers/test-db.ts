// Test-only database handle that talks to a REAL Postgres through the Neon
// WebSocket proxy — the same `@neondatabase/serverless` driver the app uses in
// production, so transactions, pg_advisory_xact_lock, and CHECK/FK constraints
// all behave exactly as they will in prod. PGlite is deliberately NOT used: it
// is single-connection (its v0.4 multiplexing serializes clients over one
// backend), so it cannot reproduce the concurrent advisory-lock race that the
// provisioning code exists to prevent.
//
// The connection target comes from TEST_DATABASE_URL + the wsProxy host/port,
// which docker-compose.test.yml (Postgres + ghcr.io/neondatabase/wsproxy) wires
// up. See tests/integration/README for how to run locally.

import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '@/db/schema';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://test:test@localhost:55432/agentcore_test';

// Where the Neon WebSocket proxy listens (NOT Postgres directly). The driver
// speaks the Neon wire protocol over WS; the proxy bridges to plain Postgres.
// The ghcr.io/neondatabase/wsproxy image serves the endpoint at `/v1` — the
// path is required (without it the proxy returns HTTP 404 on the upgrade).
const WS_PROXY = process.env.TEST_WS_PROXY ?? 'localhost:54444/v1';

// Configure the serverless driver for a local, non-TLS proxy. These mirror the
// documented local-development setup for @neondatabase/serverless.
neonConfig.webSocketConstructor = ws;
neonConfig.useSecureWebSocket = false;
neonConfig.pipelineConnect = false;
neonConfig.wsProxy = () => WS_PROXY;

export type TestPool = Pool;

// A fresh pool per call so a test can hold multiple independent backend
// connections (required to exercise the advisory-lock race for real).
export function makeTestPool(): TestPool {
  return new Pool({ connectionString: TEST_DATABASE_URL });
}

export function makeTestDb(pool: TestPool) {
  return drizzle(pool, { schema });
}

export { schema };
