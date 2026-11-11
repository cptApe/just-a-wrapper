import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { creditGrant } from '@/db/schema';
import { creditGrantMachine } from '../lib/credit-grant-machine';
import type { LockedLedger } from './ledger-lock';

// The one module that writes credit_grant rows; every write needs the workspace's ledger lock.
type NewCreditGrant = Omit<typeof creditGrant.$inferInsert, 'id' | 'workspaceId' | 'status'>;

/** Inserts a grant; returns its id, or undefined when the source reference already exists. */
export async function insertCreditGrant(
  ledger: LockedLedger,
  values: NewCreditGrant,
): Promise<string | undefined> {
  const inserted = await ledger.tx
    .insert(creditGrant)
    .values({ ...values, workspaceId: ledger.workspaceId })
    .onConflictDoNothing({ target: [creditGrant.workspaceId, creditGrant.sourceRef] })
    .returning({ id: creditGrant.id });
  return inserted.at(0)?.id;
}

export async function retireCreditGrants(ledger: LockedLedger, predicate: SQL): Promise<boolean> {
  const moved = await ledger.tx
    .update(creditGrant)
    .set({ status: 'retired' })
    .where(
      and(
        eq(creditGrant.workspaceId, ledger.workspaceId),
        predicate,
        inArray(creditGrant.status, creditGrantMachine.sourcesOf('retired')),
      ),
    )
    .returning({ id: creditGrant.id });
  return moved.length > 0;
}

export async function updateGrantConsumption(
  ledger: LockedLedger,
  id: string,
  consumed: number | SQL,
): Promise<boolean> {
  const moved = await ledger.tx
    .update(creditGrant)
    .set({ consumed })
    .where(
      and(
        eq(creditGrant.id, id),
        eq(creditGrant.workspaceId, ledger.workspaceId),
        inArray(creditGrant.status, creditGrantMachine.sourcesOf('issued')),
      ),
    )
    .returning({ id: creditGrant.id });
  return moved.length > 0;
}
