import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { env } from '@/lib/env';
import { applyLocalDatabaseProxy } from './local-proxy';
import * as schema from './schema';

// A contributor without Neon points DATABASE_WS_PROXY at docker-compose.dev.yml.
applyLocalDatabaseProxy(neonConfig, process.env);

// neon-serverless (WebSocket Pool) rather than neon-http, because Better Auth and
// our provisioning hooks need real transactions, which the HTTP driver can't do.
const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
