import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { type ManualTopupStatus, manualTopupAttempt } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import 'server-only';
import { manualTopupMachine } from '../lib/manual-topup-machine';
import { STRIPE_IDEMPOTENCY_SAFE_HOURS } from '../lib/stripe-idempotency';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ManualTopupAttempt = {
  status: ManualTopupStatus;
  stripePaymentIntentId: string | null;
  createdAt: Date;
  // Decided on the database clock: whether Stripe may have forgotten the attempt key.
  pastIdempotencyWindow: boolean;
};

// The first request with a key records it; every retry reads the same row, whatever the browser's clock.
export async function openManualTopupAttempt(input: {
  workspaceId: string;
  attemptKey: string;
  credits: number;
}): Promise<ManualTopupAttempt> {
  await db
    .insert(manualTopupAttempt)
    .values(input)
    .onConflictDoNothing({
      target: [manualTopupAttempt.workspaceId, manualTopupAttempt.attemptKey],
    });
  const row = (
    await db
      .select({
        credits: manualTopupAttempt.credits,
        status: manualTopupAttempt.status,
        stripePaymentIntentId: manualTopupAttempt.stripePaymentIntentId,
        createdAt: manualTopupAttempt.createdAt,
        pastIdempotencyWindow: sql<boolean>`${manualTopupAttempt.createdAt} <= now() - make_interval(hours => ${STRIPE_IDEMPOTENCY_SAFE_HOURS})`,
      })
      .from(manualTopupAttempt)
      .where(
        and(
          eq(manualTopupAttempt.workspaceId, input.workspaceId),
          eq(manualTopupAttempt.attemptKey, input.attemptKey),
        ),
      )
  ).at(0);
  if (!row)
    throw new BillingError('UNEXPECTED', 'Manual top-up attempt vanished after insert', {
      workspaceId: input.workspaceId,
    });
  // A key belongs to one pack; reusing it for another amount would replay the wrong charge.
  if (row.credits !== input.credits)
    throw new BillingError('CONFLICT', 'This purchase attempt is for a different amount', {
      workspaceId: input.workspaceId,
      attemptCredits: row.credits,
      credits: input.credits,
    });
  return row;
}

export async function moveManualTopupAttempt(input: {
  workspaceId: string;
  attemptKey: string;
  status: Exclude<ManualTopupStatus, 'open'>;
  paymentIntentId: string | null;
}): Promise<boolean> {
  const moved = await db
    .update(manualTopupAttempt)
    .set({
      status: input.status,
      updatedAt: sql`now()`,
      ...(input.paymentIntentId === null ? {} : { stripePaymentIntentId: input.paymentIntentId }),
    })
    .where(
      and(
        eq(manualTopupAttempt.workspaceId, input.workspaceId),
        eq(manualTopupAttempt.attemptKey, input.attemptKey),
        inArray(manualTopupAttempt.status, manualTopupMachine.sourcesOf(input.status)),
      ),
    )
    .returning({ status: manualTopupAttempt.status });
  return moved.length > 0;
}

/** A paid top-up webhook settles the attempt its metadata names, if the server recorded one. */
export async function settleManualTopupFromMetadata(
  metadata: Record<string, string> | null | undefined,
  paymentIntentId: string,
): Promise<void> {
  const workspaceId = metadata?.workspace_id;
  const attemptKey = metadata?.manual_attempt_key;
  if (!workspaceId || !attemptKey || !UUID.test(workspaceId)) return;
  await moveManualTopupAttempt({ workspaceId, attemptKey, status: 'succeeded', paymentIntentId });
}
