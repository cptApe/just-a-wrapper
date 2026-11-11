import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { type AutoTopupStatus, autoTopupAttempt } from '@/db/schema';
import { autoTopupMachine } from '../lib/auto-topup-machine';
import type { BillingTx } from './credit-ledger';

type AutoTopupMove =
  | { id: string; status: 'charging'; paymentMethodId: string }
  | { id: string; status: 'pending' | 'succeeded' | 'failed'; paymentIntentId: string | null }
  | { id: string; status: 'superseded' };

export async function moveAutoTopupAttempt(
  executor: Pick<BillingTx, 'update'>,
  move: AutoTopupMove,
): Promise<boolean> {
  const status: AutoTopupStatus = move.status;
  const paymentIntentId = 'paymentIntentId' in move ? move.paymentIntentId : null;
  const moved = await executor
    .update(autoTopupAttempt)
    .set({
      status,
      updatedAt: sql`now()`,
      ...(move.status === 'charging' ? { paymentMethodId: move.paymentMethodId } : {}),
      ...(paymentIntentId === null ? {} : { stripePaymentIntentId: paymentIntentId }),
    })
    .where(
      and(
        eq(autoTopupAttempt.id, move.id),
        inArray(autoTopupAttempt.status, autoTopupMachine.sourcesOf(status)),
        // Superseding is only for an attempt that never reached Stripe.
        status === 'superseded' ? isNull(autoTopupAttempt.stripePaymentIntentId) : undefined,
        paymentIntentId === null
          ? undefined
          : or(
              isNull(autoTopupAttempt.stripePaymentIntentId),
              eq(autoTopupAttempt.stripePaymentIntentId, paymentIntentId),
            ),
      ),
    )
    .returning({ id: autoTopupAttempt.id });
  return moved.length > 0;
}

export async function reconcileAutoTopupIntent(
  intent: { id: string; metadata: Record<string, string> },
  status: 'succeeded' | 'failed',
): Promise<void> {
  const id = intent.metadata.auto_topup_attempt_id;
  if (!id) return;
  // A replay finds the attempt terminal and leaves both its status and cooldown timestamp intact.
  await moveAutoTopupAttempt(db, { id, status, paymentIntentId: intent.id });
}
