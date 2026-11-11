import { randomUUID } from 'node:crypto';
import { and, eq, gt, lte, min, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { type CreditDebtKind, creditGrant, welcomeCreditGrant, workspace } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import { requestBudgetSync } from './budget-sync-transitions';
import {
  insertCreditGrant,
  retireCreditGrants,
  updateGrantConsumption,
} from './credit-grant-transitions';
import { type LockedLedger, lockLedger, lockLiveLedger } from './ledger-lock';
import 'server-only';
import { allocateGrantConsumption } from '../lib/credit-grants';
import {
  expiresAtMonthsAfter,
  TOPUP_CREDIT_EXPIRY_MONTHS,
  WELCOME_CREDITS,
} from '../pricing-config';

export type BillingTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const DEBT_EXPIRES_AT = new Date('9999-12-31T23:59:59.999Z');

// Balances compare grants to the database clock. A grant stamped by the app clock can sit in the
// future of that clock, which hides paid credits from every balance read.
const databaseNow = sql`now()`.mapWith(creditGrant.issuedAt);

export type IssueGrantInput = {
  source: 'plan' | 'topup' | 'welcome';
  sourceRef: string;
  amount: number;
  // 'now' is the ledger's database clock. A date is only for a bucket that starts in the future.
  issuedAt: 'now' | Date;
  expiresAt: Date;
  parentGrantId?: string;
};

// Refresh only grants available now; yearly subscriptions store future monthly buckets that cannot be spent early.
export async function issueCreditGrant(
  ledger: LockedLedger,
  input: IssueGrantInput,
): Promise<boolean> {
  if (input.issuedAt !== 'now' && input.issuedAt <= ledger.now)
    throw new BillingError('UNEXPECTED', 'A dated credit grant must start in the future', {
      workspaceId: ledger.workspaceId,
      sourceRef: input.sourceRef,
    });
  const issuedAt = input.issuedAt === 'now' ? ledger.now : input.issuedAt;
  const grantId = await insertCreditGrant(ledger, {
    source: input.source,
    sourceRef: input.sourceRef,
    amount: input.amount,
    issuedAt,
    expiresAt: input.expiresAt,
    parentGrantId: input.parentGrantId ?? null,
  });
  if (!grantId) return false;
  await requestBudgetSync(ledger.tx, ledger.workspaceId);
  await applyGrantToLedgerDebt(ledger, grantId, input.amount, issuedAt);
  return true;
}

// Welcome credits are once per person: the welcome_credit_grant key outlives every workspace.
// Use purchased-credit expiry because a workspace without a plan has no renewal boundary.
export async function grantWelcomeCredits(
  tx: BillingTx,
  input: { workspaceId: string; userId: string },
): Promise<boolean> {
  // Deployments may disable the welcome grant through pricing configuration.
  const amount: number = WELCOME_CREDITS;
  if (amount <= 0) return false;
  const ledger = await lockLiveLedger(tx, input.workspaceId);
  if (!ledger)
    throw new BillingError('WORKSPACE_NOT_FOUND', 'no workspace for welcome credits', input);
  const first = await tx
    .insert(welcomeCreditGrant)
    .values({ userId: input.userId, workspaceId: input.workspaceId })
    .onConflictDoNothing({ target: welcomeCreditGrant.userId })
    .returning({ userId: welcomeCreditGrant.userId });
  if (first.length === 0) return false;
  return issueCreditGrant(ledger, {
    source: 'welcome',
    sourceRef: `welcome:${input.userId}`,
    amount,
    issuedAt: 'now',
    expiresAt: expiresAtMonthsAfter(ledger.now, TOPUP_CREDIT_EXPIRY_MONTHS),
  });
}

// NO KEY UPDATE avoids conflicts with usage-event foreign-key locks. Spend all grant sources in expiry order.
export async function consumeWorkspaceCredits(
  tx: BillingTx,
  input: { workspaceId: string; credits: number },
): Promise<number> {
  const ledger = await lockLedger(tx, input.workspaceId);
  if (!ledger) {
    throw new BillingError('WORKSPACE_NOT_FOUND', 'no workspace to decrement', {
      workspaceId: input.workspaceId,
    });
  }

  const grants = await ledger.tx
    .select({
      id: creditGrant.id,
      amount: creditGrant.amount,
      consumed: creditGrant.consumed,
      expiresAt: creditGrant.expiresAt,
      issuedAt: creditGrant.issuedAt,
    })
    .from(creditGrant)
    .where(
      and(
        eq(creditGrant.workspaceId, input.workspaceId),
        eq(creditGrant.status, 'issued'),
        lte(creditGrant.issuedAt, ledger.now),
        gt(creditGrant.expiresAt, ledger.now),
        sql`${creditGrant.consumed} < ${creditGrant.amount}`,
      ),
    )
    .orderBy(creditGrant.expiresAt, creditGrant.issuedAt, creditGrant.id)
    .for('update');

  for (const grant of grants) {
    const repaid = await settleLedgerDebt(ledger, grant.amount - grant.consumed);
    if (repaid === 0) break;
    grant.consumed += repaid;
    if (!(await updateGrantConsumption(ledger, grant.id, grant.consumed)))
      throw new BillingError('CONFLICT', 'A retired grant cannot repay debt', {
        grantId: grant.id,
      });
  }

  const allocations = allocateGrantConsumption(grants, input.credits);
  for (const allocation of allocations) {
    const moved = await updateGrantConsumption(
      ledger,
      allocation.id,
      sql`${creditGrant.consumed} + ${allocation.credits}`,
    );
    if (!moved)
      throw new BillingError('CONFLICT', 'A retired grant cannot be consumed', {
        grantId: allocation.id,
      });
  }
  const allocated = allocations.reduce((total, allocation) => total + allocation.credits, 0);
  const shortfall = input.credits - allocated;
  if (shortfall > 0) await insertDebt(ledger, { debt: shortfall, kind: 'usage' });
  return deriveWorkspaceCreditBalance(ledger.tx, input.workspaceId);
}

// Retiring a future plan bucket must restore debt it provisionally repaid, not forgive that debt.
export async function retireFuturePlanGrants(ledger: LockedLedger): Promise<void> {
  const holds = await ledger.tx
    .select({ id: creditGrant.id, amount: creditGrant.amount, consumed: creditGrant.consumed })
    .from(creditGrant)
    .where(
      and(
        eq(creditGrant.workspaceId, ledger.workspaceId),
        eq(creditGrant.status, 'issued'),
        eq(creditGrant.debtKind, 'hold'),
        sql`${creditGrant.consumed} > ${creditGrant.amount}`,
        gt(creditGrant.expiresAt, ledger.now),
      ),
    )
    .for('update');

  for (const hold of holds) {
    await insertDebt(ledger, {
      debt: hold.consumed - hold.amount,
      kind: 'restored',
      parentGrantId: hold.id,
      sourceRef: `debt:restored:${hold.id}`,
    });
    if (!(await updateGrantConsumption(ledger, hold.id, hold.amount)))
      throw new BillingError('CONFLICT', 'A retired debt hold cannot be settled', {
        grantId: hold.id,
      });
  }

  await retireCreditGrants(
    ledger,
    sql`${creditGrant.source} = 'plan' and ${creditGrant.issuedAt} > ${ledger.now}`,
  );
}

/** Records debt that is owed now; the source reference is the idempotency key when one exists. */
export async function insertDebt(
  ledger: LockedLedger,
  input: {
    debt: number;
    kind: Exclude<CreditDebtKind, 'hold'>;
    parentGrantId?: string;
    sourceRef?: string;
  },
): Promise<void> {
  await insertCreditGrant(ledger, {
    source: 'debt',
    debtKind: input.kind,
    parentGrantId: input.parentGrantId ?? null,
    sourceRef: input.sourceRef ?? `debt:${randomUUID()}`,
    amount: input.debt,
    consumed: input.debt * 2,
    issuedAt: ledger.now,
    expiresAt: DEBT_EXPIRES_AT,
  });
}

async function settleLedgerDebt(ledger: LockedLedger, availableCredits: number): Promise<number> {
  const debtRows = await ledger.tx
    .select({ id: creditGrant.id, amount: creditGrant.amount, consumed: creditGrant.consumed })
    .from(creditGrant)
    .where(
      and(
        eq(creditGrant.workspaceId, ledger.workspaceId),
        eq(creditGrant.status, 'issued'),
        eq(creditGrant.source, 'debt'),
        ne(creditGrant.debtKind, 'hold'),
        sql`${creditGrant.consumed} > ${creditGrant.amount}`,
      ),
    )
    .orderBy(creditGrant.issuedAt, creditGrant.id)
    .for('update');

  let remaining = availableCredits;
  for (const debt of debtRows) {
    if (remaining === 0) break;
    const repayment = Math.min(remaining, debt.consumed - debt.amount);
    if (!(await updateGrantConsumption(ledger, debt.id, debt.consumed - repayment)))
      throw new BillingError('CONFLICT', 'A retired debt grant cannot be settled', {
        grantId: debt.id,
      });
    remaining -= repayment;
  }
  return availableCredits - remaining;
}

async function applyGrantToLedgerDebt(
  ledger: LockedLedger,
  grantId: string,
  amount: number,
  issuedAt: Date,
): Promise<void> {
  const debtRepaid = await settleLedgerDebt(ledger, amount);
  if (debtRepaid === 0) return;
  if (!(await updateGrantConsumption(ledger, grantId, debtRepaid)))
    throw new BillingError('CONFLICT', 'A retired grant cannot repay debt', { grantId });

  // Hold repaid debt negative until the matching future bucket activates, avoiding early spendable credit.
  if (issuedAt > ledger.now) {
    await insertCreditGrant(ledger, {
      source: 'debt',
      debtKind: 'hold',
      parentGrantId: grantId,
      sourceRef: `debt:hold:${grantId}`,
      amount: debtRepaid,
      consumed: debtRepaid * 2,
      issuedAt: ledger.now,
      expiresAt: issuedAt,
    });
  }
}

export async function deriveWorkspaceCreditBalance(
  executor: Pick<typeof db, 'select'>,
  workspaceId: string,
): Promise<number> {
  const row = (
    await executor
      .select({
        available: sql<number>`coalesce(sum(${creditGrant.amount} - ${creditGrant.consumed}), 0)::int`,
      })
      .from(creditGrant)
      .where(
        and(
          eq(creditGrant.workspaceId, workspaceId),
          eq(creditGrant.status, 'issued'),
          lte(creditGrant.issuedAt, databaseNow),
          gt(creditGrant.expiresAt, databaseNow),
        ),
      )
  ).at(0);
  return row?.available ?? 0;
}

export async function getLiveCreditBalance(workspaceId: string): Promise<number> {
  const workspaceRow = (
    await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)
  ).at(0);
  if (!workspaceRow)
    throw new BillingError('WORKSPACE_NOT_FOUND', 'no workspace for balance read', {
      workspaceId,
    });
  return deriveWorkspaceCreditBalance(db, workspaceId);
}

export async function getCurrentPlanCreditsExpireAt(workspaceId: string): Promise<Date | null> {
  const row = (
    await db
      // min() decodes through the column; a raw sql aggregate returns the driver's text.
      .select({ expiresAt: min(creditGrant.expiresAt) })
      .from(creditGrant)
      .where(
        and(
          eq(creditGrant.workspaceId, workspaceId),
          eq(creditGrant.status, 'issued'),
          eq(creditGrant.source, 'plan'),
          lte(creditGrant.issuedAt, databaseNow),
          gt(creditGrant.expiresAt, databaseNow),
          sql`${creditGrant.consumed} < ${creditGrant.amount}`,
        ),
      )
  ).at(0);
  return row?.expiresAt ?? null;
}
