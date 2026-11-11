import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// No membership FK: cleanup must survive deletion of the member and workspace.
export const integrationCleanup = pgTable(
  'integration_cleanup',
  {
    composioUserId: text('composio_user_id').primaryKey(),
    requiresComposio: boolean('requires_composio').notNull().default(true),
    vaultId: text('vault_id'),
    memoryStoreId: text('memory_store_id'),
    status: text('status').$type<'pending' | 'working'>().notNull().default('pending'),
    purgeAttemptedAt: timestamp('purge_attempted_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (table) => [
    check('integration_cleanup_status_check', sql`${table.status} in ('pending', 'working')`),
    check(
      'integration_cleanup_claim_check',
      sql`(${table.status} = 'working') = (${table.claimedAt} is not null)`,
    ),
  ],
);
