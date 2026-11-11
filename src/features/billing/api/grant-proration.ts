import { and, eq, gt } from 'drizzle-orm';
import { creditGrant } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import 'server-only';
import { invoiceGrantRef } from '../lib/grant-refs';
import { creditsForPaidCents, splitCreditsAcrossMonths } from '../lib/webhook-credit-split';
import { type BillingInterval, expiresAtMonthsAfter } from '../pricing-config';
import { issueCreditGrant } from './credit-ledger';
import type { LockedLedger } from './ledger-lock';

// Spread paid annual proration over the current and scheduled months; keep each purchase separate without changing its expiry.
export async function grantProration(
  ledger: LockedLedger,
  input: {
    invoiceId: string;
    paidCents: number | null | undefined;
    interval: BillingInterval;
    expiryMonths: number;
  },
): Promise<number> {
  const totalCredits = creditsForPaidCents(input.paidCents, input.interval);
  if (totalCredits <= 0) return 0;

  const scheduled = await ledger.tx
    .selectDistinct({
      issuedAt: creditGrant.issuedAt,
      expiresAt: creditGrant.expiresAt,
    })
    .from(creditGrant)
    .where(
      and(
        eq(creditGrant.workspaceId, ledger.workspaceId),
        eq(creditGrant.source, 'plan'),
        eq(creditGrant.status, 'issued'),
        gt(creditGrant.issuedAt, ledger.now),
      ),
    )
    .orderBy(creditGrant.issuedAt);

  const shares = splitCreditsAcrossMonths(totalCredits, scheduled.length + 1);
  const currentShare = shares.at(0);
  if (currentShare === undefined)
    throw new BillingError('UNEXPECTED', 'Proration has no current-month allocation', {
      invoiceId: input.invoiceId,
    });
  if (currentShare > 0) {
    await issueCreditGrant(ledger, {
      source: 'plan',
      sourceRef: invoiceGrantRef(input.invoiceId, 0),
      amount: currentShare,
      issuedAt: 'now',
      expiresAt: expiresAtMonthsAfter(ledger.now, input.expiryMonths),
    });
  }
  if (scheduled.length === 0) return totalCredits;

  for (const [index, bucket] of scheduled.entries()) {
    const share = shares.at(index + 1);
    if (share === undefined)
      throw new BillingError('UNEXPECTED', 'Proration has no scheduled-month allocation', {
        invoiceId: input.invoiceId,
        month: index + 1,
      });
    if (share === 0) continue;
    await issueCreditGrant(ledger, {
      source: 'plan',
      sourceRef: invoiceGrantRef(input.invoiceId, index + 1),
      amount: share,
      issuedAt: bucket.issuedAt,
      expiresAt: bucket.expiresAt,
    });
  }
  return totalCredits;
}
