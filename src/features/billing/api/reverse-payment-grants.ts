import 'server-only';
import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { creditGrant, paymentCreditReversal } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import { expiresAtMonthsAfter, TOPUP_CREDIT_EXPIRY_MONTHS } from '../pricing-config';
import { requestBudgetSync } from './budget-sync-transitions';
import {
  insertCreditGrant,
  retireCreditGrants,
  updateGrantConsumption,
} from './credit-grant-transitions';
import { insertDebt, issueCreditGrant } from './credit-ledger';
import type { LockedLedger } from './ledger-lock';

type Grant = typeof creditGrant.$inferSelect;
type Reversal = { grant: Grant; chargeId: string; revision: number; prefix: string };

// A purchase's refund debt rows; credits that restore that debt name one of them as their parent.
async function refundDebtIdsOf(ledger: LockedLedger, grantId: string): Promise<string[]> {
  const rows = await ledger.tx
    .select({ id: creditGrant.id })
    .from(creditGrant)
    .where(
      and(
        eq(creditGrant.workspaceId, ledger.workspaceId),
        eq(creditGrant.debtKind, 'refund'),
        eq(creditGrant.parentGrantId, grantId),
      ),
    )
    .orderBy(desc(creditGrant.issuedAt), desc(creditGrant.id));
  return rows.map((row) => row.id);
}

export async function reversePaymentGrant(
  ledger: LockedLedger,
  input: { grant: Grant; chargeId: string; removedFraction: number; planActive: boolean },
): Promise<boolean> {
  const { tx } = ledger;
  const { grant, chargeId } = input;
  const [prior] = await tx
    .select()
    .from(paymentCreditReversal)
    .where(
      and(
        eq(paymentCreditReversal.chargeId, chargeId),
        eq(paymentCreditReversal.grantId, grant.id),
      ),
    );
  const removed = Math.min(grant.amount, Math.round(grant.amount * input.removedFraction));
  const delta = removed - (prior?.removedCredits ?? 0);
  if (delta === 0) return false;
  const context = {
    grant,
    chargeId,
    revision: (prior?.revision ?? 0) + 1,
    prefix: `refund-credit:${grant.id}:`,
  };
  const refundDebtIds = await refundDebtIdsOf(ledger, grant.id);
  const restoresDebt = (bucket: Grant) =>
    bucket.parentGrantId !== null && refundDebtIds.includes(bucket.parentGrantId);
  const buckets = await tx
    .select()
    .from(creditGrant)
    .where(
      and(
        eq(creditGrant.workspaceId, grant.workspaceId),
        ne(creditGrant.source, 'debt'),
        or(
          eq(creditGrant.id, grant.id),
          eq(creditGrant.parentGrantId, grant.id),
          refundDebtIds.length > 0 ? inArray(creditGrant.parentGrantId, refundDebtIds) : undefined,
        ),
      ),
    )
    .orderBy(creditGrant.issuedAt, creditGrant.id)
    .for('update');
  // Retired parents retain consumption. Debt restored after another purchase repaid it
  // is spendable credit that a later reversal must remove too.
  const unconsumed = Math.max(
    0,
    buckets.reduce(
      (remaining, bucket) =>
        restoresDebt(bucket)
          ? remaining + bucket.amount - bucket.consumed
          : remaining - bucket.consumed,
      grant.amount,
    ),
  );
  let balanceRemoved = prior?.balanceRemoved ?? 0;
  let debtCredits = prior?.debtCredits ?? 0;
  if (delta > 0) {
    const removal = await removePurchasedCredits(ledger, context, buckets, {
      removed,
      delta,
      debtCredits,
      unconsumed,
    });
    balanceRemoved += removal.retired + removal.additionalDebt;
    debtCredits += removal.additionalDebt;
  } else {
    const debtTarget = Math.max(0, removed - unconsumed);
    const debtRestored = Math.max(0, debtCredits - debtTarget);
    const liveRestored = Math.max(
      0,
      balanceRemoved - debtCredits - Math.max(0, removed - debtTarget),
    );
    const restored = debtRestored + liveRestored;
    // Debt repayment grants have distinct references so repayment is not counted as new consumption.
    if (debtRestored > 0) {
      const refundDebtId = refundDebtIds.at(0);
      if (!refundDebtId)
        throw new BillingError('UNEXPECTED', 'Restored debt has no refund debt row', {
          grantId: grant.id,
          chargeId,
        });
      await restoreCredits(ledger, context, debtRestored, { kind: 'debt', refundDebtId });
    }
    if (liveRestored > 0 && (grant.source !== 'plan' || input.planActive))
      await restoreCredits(ledger, context, liveRestored, { kind: 'live' });
    balanceRemoved -= restored;
    debtCredits -= debtRestored;
  }
  const progress = {
    removedCredits: removed,
    balanceRemoved,
    debtCredits,
    revision: context.revision,
  };
  await tx
    .insert(paymentCreditReversal)
    .values({ chargeId, grantId: grant.id, ...progress })
    .onConflictDoUpdate({
      target: [paymentCreditReversal.chargeId, paymentCreditReversal.grantId],
      set: progress,
    });
  await requestBudgetSync(tx, grant.workspaceId);
  return true;
}

// Live credits return as a child of the purchase; debt credits as a child of its refund debt.
async function restoreCredits(
  ledger: LockedLedger,
  input: Reversal,
  amount: number,
  target: { kind: 'live' } | { kind: 'debt'; refundDebtId: string },
) {
  const { grant, chargeId, revision, prefix } = input;
  const { now } = ledger;
  await issueCreditGrant(ledger, {
    source: grant.source === 'plan' ? 'plan' : 'topup',
    sourceRef:
      target.kind === 'live'
        ? `${prefix}${chargeId}:${revision}:restored`
        : `refund-debt-restored:${grant.id}:${chargeId}:${revision}`,
    parentGrantId: target.kind === 'live' ? grant.id : target.refundDebtId,
    amount,
    issuedAt: target.kind === 'live' && grant.issuedAt > now ? grant.issuedAt : 'now',
    expiresAt:
      grant.expiresAt > now
        ? grant.expiresAt
        : expiresAtMonthsAfter(now, TOPUP_CREDIT_EXPIRY_MONTHS),
  });
}

async function removeLiveCredits(
  ledger: LockedLedger,
  input: Reversal,
  buckets: Grant[],
  credits: number,
): Promise<number> {
  const { grant, chargeId, prefix, revision } = input;
  let remaining = credits;
  for (const bucket of buckets) {
    if (bucket.status !== 'issued' || bucket.expiresAt <= ledger.now) continue;
    const removed = Math.min(remaining, bucket.amount - bucket.consumed);
    if (removed <= 0) continue;
    if (!(await retireCreditGrants(ledger, eq(creditGrant.id, bucket.id))))
      throw new BillingError('CONFLICT', 'Refund lost its grant lock', { grantId: bucket.id });
    const remainder = bucket.amount - bucket.consumed - removed;
    // The remainder keeps the bucket's dates; as a child of the purchase its later spending counts.
    if (remainder > 0)
      await insertCreditGrant(ledger, {
        source: bucket.source,
        sourceRef: `${prefix}${chargeId}:${revision}:remainder:${bucket.id}`,
        parentGrantId: grant.id,
        amount: remainder,
        issuedAt: bucket.issuedAt,
        expiresAt: bucket.expiresAt,
      });
    remaining -= removed;
    if (remaining === 0) break;
  }
  return credits - remaining;
}

async function createRefundDebt(
  ledger: LockedLedger,
  input: Reversal,
  credits: number,
): Promise<void> {
  const { grant, chargeId, revision } = input;
  // Replace a future bucket's provisional debt hold instead of counting it alongside refund debt.
  const [hold] = await ledger.tx
    .select()
    .from(creditGrant)
    .where(
      and(
        eq(creditGrant.workspaceId, grant.workspaceId),
        eq(creditGrant.debtKind, 'hold'),
        eq(creditGrant.parentGrantId, grant.id),
        eq(creditGrant.status, 'issued'),
      ),
    );
  if (hold && hold.expiresAt > ledger.now)
    await updateGrantConsumption(ledger, hold.id, Math.max(hold.amount, hold.consumed - credits));
  await insertDebt(ledger, {
    debt: credits,
    kind: 'refund',
    parentGrantId: grant.id,
    sourceRef: `debt:refund:${chargeId}:${grant.id}:${revision}`,
  });
}

async function removePurchasedCredits(
  ledger: LockedLedger,
  context: Reversal,
  buckets: Grant[],
  progress: { removed: number; delta: number; debtCredits: number; unconsumed: number },
) {
  const debtTarget = Math.max(0, progress.removed - progress.unconsumed);
  const additionalDebt = Math.max(0, debtTarget - progress.debtCredits);
  const retired = await removeLiveCredits(
    ledger,
    context,
    buckets,
    progress.delta - additionalDebt,
  );
  if (additionalDebt > 0) await createRefundDebt(ledger, context, additionalDebt);
  return { retired, additionalDebt };
}
