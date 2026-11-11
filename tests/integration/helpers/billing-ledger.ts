// Fixtures use the same ledger representation as production; balance reads remain time-dependent.
import { eq, sql } from 'drizzle-orm';
import { creditGrant } from '@/db/schema';
import { type LockedLedger, lockLedger } from '@/features/billing/api/ledger-lock';
import type { makeTestDb } from './test-db';

// Ledger writers take the workspace lock handle, so fixtures lock exactly as production callers do.
export function withLockedLedger<T>(
  database: ReturnType<typeof makeTestDb>,
  workspaceId: string,
  run: (ledger: LockedLedger) => Promise<T>,
): Promise<T> {
  return database.transaction(async (tx) => {
    const ledger = await lockLedger(tx, workspaceId);
    if (!ledger) throw new Error(`Missing workspace ${workspaceId}`);
    return run(ledger);
  });
}

export const creditBalanceProjection = sql`(select coalesce(sum(amount - consumed), 0)::int from credit_grant where workspace_id = workspace.id and status = 'issued' and issued_at <= now() and expires_at > now()) as credit_balance`;
export async function seedCreditBalance(
  database: ReturnType<typeof makeTestDb>,
  workspaceId: string,
  balance: number,
) {
  await database.delete(creditGrant).where(eq(creditGrant.workspaceId, workspaceId));
  if (balance === 0) return;
  await database.insert(creditGrant).values({
    workspaceId,
    source: balance > 0 ? 'topup' : 'debt',
    debtKind: balance > 0 ? null : 'usage',
    sourceRef: 'fixture',
    amount: Math.abs(balance),
    consumed: balance < 0 ? -balance * 2 : 0,
    issuedAt: new Date('2020-01-01'),
    expiresAt: new Date('9999-01-01'),
  });
}

// Production reads the balance only at the database clock; tests check a future instant directly.
export async function balanceAt(
  database: ReturnType<typeof makeTestDb>,
  workspaceId: string,
  at: Date,
): Promise<number> {
  const { rows } = await database.execute<{ balance: number }>(
    sql`select coalesce(sum(amount - consumed), 0)::int as balance from credit_grant
        where workspace_id = ${workspaceId} and status = 'issued'
          and issued_at <= ${at.toISOString()}::timestamptz and expires_at > ${at.toISOString()}::timestamptz`,
  );
  return rows.at(0)?.balance ?? 0;
}

// Funds every workspace seeded so far, for fixtures whose sends must pass the spend gate.
export async function fundAllWorkspaces(database: ReturnType<typeof makeTestDb>, credits = 1000) {
  await database.execute(sql`insert into credit_grant (workspace_id, source, source_ref, amount, consumed, issued_at, expires_at)
    select id, 'topup', 'fixture', ${credits}, 0, '2020-01-01'::timestamptz, '9999-01-01'::timestamptz from workspace`);
}
