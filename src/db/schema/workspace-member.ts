import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { organization, user } from './auth';

// One row per user-in-organization. `organization_id` / `user_id` FK to Better
// Auth's `organization` / `user`, both ON DELETE cascade — a membership row is
// meaningless once either side is gone. Role is NOT stored here — it is joined
// from Better Auth's `member` table, which lives in the same DB. This row holds
// only app-specific per-member state: the Composio tenant id, the user memory
// store, the MCP-proxy vault id, and the cached Composio Tool Router URL.
export const workspaceMember = pgTable(
  'workspace_member',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    composioUserId: text('composio_user_id').notNull().unique(),
    browserbaseContextId: text('browserbase_context_id'),
    userMemoryStoreId: text('user_memory_store_id'),
    mcpProxyVaultId: text('mcp_proxy_vault_id'),
    vaultStatus: text('vault_status')
      .$type<'unprovisioned' | 'provisioning' | 'provisioned'>()
      .notNull()
      .default('unprovisioned'),
    vaultClaimedAt: timestamp('vault_claimed_at', { withTimezone: true }),
    vaultCredentialKey: text('vault_credential_key'),
    vaultCredentialUpdatedAt: timestamp('vault_credential_updated_at', { withTimezone: true }),
    // Durable cache of this member's Composio Tool Router MCP URL.
    // The MCP proxy reads this to forward
    // JSON-RPC; in-memory caching is an L1 only and DB is truth. Null until the
    // first mint; re-minted on miss/expiry/upstream-auth-failure. `minted_at`
    // gates the proxy's soft TTL so a stale URL gets refreshed rather than
    // forwarded blindly.
    toolRouterUrl: text('tool_router_url'),
    toolRouterMintedAt: timestamp('tool_router_minted_at', { withTimezone: true }),
    // Every clear and every mint bumps this, and a mint persists only onto the
    // generation it read, so a clear always wins over a mint that started before it.
    toolRouterGeneration: integer('tool_router_generation').notNull().default(0),
    provisioningStatus: text('provisioning_status')
      .$type<'pending' | 'ready'>()
      .notNull()
      .default('pending'),
    provisionCapabilityKey: text('provision_capability_key'),
    // User-driven activity gates away email; background feed reads must not refresh it.
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    notificationsSeenAt: timestamp('notifications_seen_at', { withTimezone: true }),
    // Optional credits-per-billing-period ceiling. Null means unrestricted.
    // Enforcement lives in billing accrual, where usage is attributed through
    // the session creator and checked transactionally before a new charge lands.
    creditLimit: integer('credit_limit'),
  },
  (t) => [
    check(
      'workspace_member_provisioning_status_check',
      sql`${t.provisioningStatus} in ('pending', 'ready')`,
    ),
    check(
      'workspace_member_provisioning_key_check',
      sql`${t.provisioningStatus} <> 'ready' or ${t.provisionCapabilityKey} is not null`,
    ),
    primaryKey({ columns: [t.organizationId, t.userId] }),
    check(
      'workspace_member_vault_status_check',
      sql`${t.vaultStatus} in ('unprovisioned', 'provisioning', 'provisioned')`,
    ),
    check(
      'workspace_member_vault_state_check',
      sql`(${t.vaultStatus} = 'unprovisioned' and ${t.vaultClaimedAt} is null) or (${t.vaultStatus} = 'provisioning' and ${t.vaultClaimedAt} is not null) or (${t.vaultStatus} = 'provisioned' and ${t.mcpProxyVaultId} is not null and ${t.vaultCredentialUpdatedAt} is not null and ${t.vaultClaimedAt} is null)`,
    ),
    check(
      'workspace_member_router_cache_check',
      sql`(${t.toolRouterUrl} is null) = (${t.toolRouterMintedAt} is null)`,
    ),
    index('workspace_member_user_id_idx').on(t.userId),
    check(
      'workspace_member_credit_limit_nonnegative_check',
      sql`${t.creditLimit} is null or ${t.creditLimit} >= 0`,
    ),
  ],
);
