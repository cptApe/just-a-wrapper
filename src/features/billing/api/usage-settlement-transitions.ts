import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { usageEvent } from '@/db/schema';
import { usageSettlementMachine } from '../lib/usage-settlement-machine';
import type { BillingTx } from './credit-ledger';

export async function completeUsageSettlement(usageKey: string): Promise<boolean> {
  const moved = await db
    .update(usageEvent)
    .set({ settlementStatus: 'complete' })
    .where(
      and(
        eq(usageEvent.usageKey, usageKey),
        inArray(usageEvent.settlementStatus, usageSettlementMachine.sourcesOf('complete')),
      ),
    )
    .returning({ id: usageEvent.id });
  return moved.length > 0;
}

// Missing billable sessions have no remaining budget or resume work; the recorded charge stays intact.
export async function completeUnloadedUsageSettlement(id: string): Promise<boolean> {
  const moved = await db
    .update(usageEvent)
    .set({ settlementStatus: 'complete' })
    .where(
      and(
        eq(usageEvent.id, id),
        inArray(usageEvent.settlementStatus, usageSettlementMachine.sourcesOf('complete')),
      ),
    )
    .returning({ id: usageEvent.id });
  return moved.length > 0;
}

// A charge or platform cost leaves side effects to deliver, so it starts pending; anything else is settled.
export async function recordUsageSettlement(
  tx: BillingTx,
  row: Omit<typeof usageEvent.$inferInsert, 'settlementStatus' | 'usageKey'> & {
    usageKey: string;
  },
) {
  const pending = row.creditsDelta < 0 || row.platformPaid === true;
  return tx
    .insert(usageEvent)
    .values({ ...row, settlementStatus: pending ? 'pending' : 'complete' })
    .onConflictDoNothing()
    .returning({ id: usageEvent.id });
}
