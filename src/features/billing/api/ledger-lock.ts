import { and, eq, sql } from 'drizzle-orm';
import { workspace, workspaceNotDeleted } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import type { BillingTx } from './credit-ledger';

declare const ledgerLockBrand: unique symbol;
/**
 * The transaction holds this workspace's row lock, which serializes every credit_grant write.
 * `now` is the transaction's database clock, the only clock the ledger decides time with.
 */
export type LockedLedger = {
  readonly tx: BillingTx;
  readonly workspaceId: string;
  readonly now: Date;
  readonly [ledgerLockBrand]: true;
};

// FOR NO KEY UPDATE or stronger; a weaker lock lets accrual and grant math interleave.
type LedgerLockStrength = 'no key update' | 'update';
type WorkspaceLockQuery<Row> = {
  for(strength: LedgerLockStrength): PromiseLike<Row[]>;
};

/** Reads the transaction's clock; Postgres keeps now() fixed for the whole transaction. */
export async function readDatabaseClock(tx: Pick<BillingTx, 'execute'>): Promise<Date> {
  const { rows } = await tx.execute<{ now: string | Date }>(sql`select now() as now`);
  const value = rows.at(0)?.now;
  if (value === undefined) throw new BillingError('UNEXPECTED', 'select now() returned no row');
  return new Date(value);
}

/** Locks a workspace row selected by the caller's query; the row decides which ledger is locked. */
export async function lockLedgerWhere<Row extends { id: string }>(
  tx: BillingTx,
  query: WorkspaceLockQuery<Row>,
  strength: LedgerLockStrength,
): Promise<{ row: Row; ledger: LockedLedger } | undefined> {
  const row = (await query.for(strength)).at(0);
  if (!row) return undefined;
  const held: Omit<LockedLedger, typeof ledgerLockBrand> = {
    tx,
    workspaceId: row.id,
    now: await readDatabaseClock(tx),
  };
  // The brand exists only in the type, so this cast is the one place a ledger lock is issued.
  return { row, ledger: held as LockedLedger };
}

export async function lockLedger(
  tx: BillingTx,
  workspaceId: string,
): Promise<LockedLedger | undefined> {
  const locked = await lockLedgerWhere(
    tx,
    tx.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, workspaceId)),
    'no key update',
  );
  return locked?.ledger;
}

/** Locks a workspace that is not deleted; issuing new credits needs a live workspace. */
export async function lockLiveLedger(
  tx: BillingTx,
  workspaceId: string,
): Promise<LockedLedger | undefined> {
  const locked = await lockLedgerWhere(
    tx,
    tx
      .select({ id: workspace.id })
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), workspaceNotDeleted)),
    'no key update',
  );
  return locked?.ledger;
}
