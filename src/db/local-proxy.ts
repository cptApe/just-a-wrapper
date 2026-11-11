import type { NeonConfig } from '@neondatabase/serverless';
// Relative import: scripts/db-migrate.ts loads this file without the @/ alias.
import { localDatabaseProxy } from '@/lib/env-schema';

type ProxySettings = Pick<NeonConfig, 'wsProxy' | 'useSecureWebSocket' | 'pipelineConnect'>;

/**
 * Points the Neon driver at a local wsproxy in front of plain Postgres when
 * DATABASE_WS_PROXY is set. The app and the migration script both call this,
 * so they always reach the same database the same way. Returns whether the
 * proxy is in use.
 */
export function applyLocalDatabaseProxy(
  config: ProxySettings,
  environment: Parameters<typeof localDatabaseProxy>[0],
): boolean {
  const proxy = localDatabaseProxy(environment);
  if (proxy === null) return false;
  config.wsProxy = () => proxy;
  // The local proxy serves plain ws://, and pipelining needs Neon's own endpoint.
  config.useSecureWebSocket = false;
  config.pipelineConnect = false;
  return true;
}
