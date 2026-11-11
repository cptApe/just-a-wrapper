// Apply pending Drizzle migrations to the configured database (the unpooled
// connection, per drizzle.config). Self-loads the env file via the pnpm script
// flag; prints no secret values.
//
//   pnpm db:migrate
//
// Uses drizzle-orm's programmatic migrator with the same neon-serverless driver
// the app uses, so it tracks applied migrations in __drizzle_migrations and only
// runs new ones (idempotent re-runs).

import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import ws from 'ws';
import { applyLocalDatabaseProxy } from '../src/db/local-proxy.ts';

neonConfig.webSocketConstructor = ws;
// DATABASE_WS_PROXY routes through a local proxy, exactly as the app does.
if (applyLocalDatabaseProxy(neonConfig, process.env)) {
  console.log('[db-migrate] Using the local database proxy from DATABASE_WS_PROXY.');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.log('[db-migrate] No DATABASE_URL — nothing to do.');
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './src/db/migrations' });
    console.log('[db-migrate] ✓ migrations applied (only pending ones run).');
  } finally {
    await pool.end();
  }
}

await main();
