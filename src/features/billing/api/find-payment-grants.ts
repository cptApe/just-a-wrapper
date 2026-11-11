import { and, eq, sql } from 'drizzle-orm';
import { creditGrant } from '@/db/schema';
import { invoiceGrantRefPrefix, topupGrantRef } from '../lib/grant-refs';
import type { BillingTx } from './credit-ledger';

// The purchase grants a payment created: a top-up by its intent, a plan by its invoice.
export async function findPaymentGrants(
  tx: BillingTx,
  input: {
    workspaceId: string;
    paymentIntentId: string | null;
    chargeAmount: number;
    invoices: Array<{ id: string; amountPaid: number }>;
  },
) {
  const purchases = [];
  if (input.paymentIntentId) {
    const grants = await tx
      .select()
      .from(creditGrant)
      .where(
        and(
          eq(creditGrant.workspaceId, input.workspaceId),
          eq(creditGrant.sourceRef, topupGrantRef(input.paymentIntentId)),
        ),
      );
    for (const grant of grants) purchases.push({ grant, paidAmount: input.chargeAmount });
  }
  for (const invoice of input.invoices) {
    const grants = await tx
      .select()
      .from(creditGrant)
      .where(
        and(
          eq(creditGrant.workspaceId, input.workspaceId),
          eq(creditGrant.source, 'plan'),
          sql`starts_with(${creditGrant.sourceRef}, ${invoiceGrantRefPrefix(invoice.id)})`,
        ),
      );
    for (const grant of grants) purchases.push({ grant, paidAmount: invoice.amountPaid });
  }
  return purchases;
}
