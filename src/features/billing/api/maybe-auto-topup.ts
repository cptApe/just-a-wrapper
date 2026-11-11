// Declines release the reservation; ambiguous provider failures keep the attempt open for the cron sweep.
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  AUTO_TOPUP_OPEN_STATUSES,
  type AutoTopupStatus,
  autoTopupAttempt,
  workspace,
  workspaceNotDeleted,
} from '@/db/schema';
import { BillingError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { getStripe } from '@/lib/stripe';
import 'server-only';
import Stripe from 'stripe';
import {
  AUTO_TOPUP_COOLDOWN_STATUSES,
  canCreateAutoTopupPayment,
  reservedAfterPendingRetry,
} from '../lib/auto-topup-policy';
import { STRIPE_IDEMPOTENCY_SAFE_HOURS } from '../lib/stripe-idempotency';
import { decideFromIntentStatus } from '../lib/topup-charge-decision';
import { AUTO_TOPUP, BILLING_CURRENCY, isPlanTier, topupAmountCents } from '../pricing-config';
import { moveAutoTopupAttempt } from './auto-topup-transitions';
import { type BillingTx, deriveWorkspaceCreditBalance } from './credit-ledger';
import { defaultCardPaymentMethod } from './default-card-payment-method';
import { grantTopupAndResume } from './grant-topup';
import { readDatabaseClock } from './ledger-lock';

type Attempt = {
  id: string;
  workspaceId: string;
  customerId: string;
  subscriptionId: string | null;
  organizationId: string;
  credits: number;
  amountCents: number;
  paymentMethodId: string | null;
};
type OpenAttempt = Attempt & {
  status: AutoTopupStatus;
  stripePaymentIntentId: string | null;
  createdAt: Date;
  pastIdempotencyWindow: boolean;
  canCreate: boolean;
};

const openStatus = inArray(autoTopupAttempt.status, [...AUTO_TOPUP_OPEN_STATUSES]);

// Settlement calls this after every charge. It decides from the database and at most starts one
// payment; finishing an attempt belongs to the webhook and the cron sweep. It never throws, so a
// Stripe outage cannot stop usage from settling.
export async function maybeAutoTopup(workspaceId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;
  try {
    if (!(await mightStartAttempt(workspaceId))) return;
    const claim = await claimNewAttempt(workspaceId);
    if (claim) await startAttempt(stripe, claim);
  } catch (error) {
    captureException(error, { feature: 'billing', op: 'auto-topup-start', workspaceId });
  }
}

// The common case skips the row lock; claimNewAttempt checks again under it.
async function mightStartAttempt(workspaceId: string): Promise<boolean> {
  const row = (
    await db
      .select({
        stripeCustomerId: workspace.stripeCustomerId,
        enabled: workspace.autoTopupEnabled,
        planTier: workspace.planTier,
        thresholdCredits: workspace.autoTopupThresholdCredits,
        // Spelled out: a single-table select renders column references without their table.
        open: sql<boolean>`exists (select 1 from auto_topup_attempt open_attempt where open_attempt.workspace_id = "workspace"."id" and open_attempt.status in ('creating', 'charging', 'pending'))`,
      })
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), workspaceNotDeleted))
  ).at(0);
  if (!row?.stripeCustomerId || !row.enabled || row.open || !isPlanTier(row.planTier)) return false;
  return (await deriveWorkspaceCreditBalance(db, workspaceId)) <= row.thresholdCredits;
}

// Lock the workspace while reserving monthly spend so concurrent purchases cannot exceed the cap.
async function claimNewAttempt(workspaceId: string): Promise<Attempt | null> {
  return db.transaction(async (tx) => {
    const row = await lockAutoTopupWorkspace(tx, workspaceId);
    if (!row?.stripeCustomerId || !isPlanTier(row.planTier)) return null;
    if (await loadOpenAttempt(tx, workspaceId)) return null;
    if (await hasRecentFailure(tx, workspaceId)) return null;
    const amountCents = topupAmountCents(row.autoTopupCredits);
    const { reserved } = await reservedThisMonth(tx, workspaceId);
    const allowed = canCreateAutoTopupPayment({
      enabled: row.autoTopupEnabled,
      paidTier: true,
      balance: await deriveWorkspaceCreditBalance(tx, workspaceId),
      thresholdCredits: row.autoTopupThresholdCredits,
      reservedAfterAttemptCents: reserved + amountCents,
      monthlyCapCents: row.autoTopupMonthlyCapCents,
    });
    if (!allowed) return null;
    const inserted = (
      await tx
        .insert(autoTopupAttempt)
        .values({ workspaceId, credits: row.autoTopupCredits, amountCents })
        .returning({ id: autoTopupAttempt.id })
    ).at(0);
    if (!inserted) return null;
    return {
      id: inserted.id,
      workspaceId,
      customerId: row.stripeCustomerId,
      subscriptionId: row.stripeSubscriptionId,
      organizationId: row.organizationId,
      credits: row.autoTopupCredits,
      amountCents,
      paymentMethodId: null,
    };
  });
}

// Freeze the card before creating the intent so a retried create sends identical parameters.
async function startAttempt(stripe: Stripe, attempt: Attempt): Promise<void> {
  let paymentMethodId = attempt.paymentMethodId;
  if (!paymentMethodId) {
    const card = await defaultCardPaymentMethod(
      stripe,
      attempt.customerId,
      attempt.subscriptionId,
      'id',
    );
    const cardId = typeof card === 'string' ? card : card?.id;
    if (!cardId) {
      await moveAutoTopupAttempt(db, { id: attempt.id, status: 'failed', paymentIntentId: null });
      return;
    }
    const frozen = await moveAutoTopupAttempt(db, {
      id: attempt.id,
      status: 'charging',
      paymentMethodId: cardId,
    });
    if (!frozen) return;
    paymentMethodId = cardId;
  }
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: attempt.amountCents,
        currency: BILLING_CURRENCY,
        customer: attempt.customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          kind: 'topup',
          auto_topup: 'true',
          auto_topup_attempt_id: attempt.id,
          workspace_id: attempt.workspaceId,
          organization_id: attempt.organizationId,
          credits: String(attempt.credits),
        },
      },
      { idempotencyKey: `auto-topup:${attempt.id}` },
    );
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeCardError)) throw error;
    await moveAutoTopupAttempt(db, {
      id: attempt.id,
      status: 'failed',
      paymentIntentId: error.payment_intent?.id ?? null,
    });
    return;
  }
  const decision = decideFromIntentStatus(intent.status);
  if (decision === 'fallback') {
    if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id);
    await moveAutoTopupAttempt(db, {
      id: attempt.id,
      status: 'failed',
      paymentIntentId: intent.id,
    });
    return;
  }
  // Succeeded or processing: the payment_intent webhook grants the credits.
  await moveAutoTopupAttempt(db, { id: attempt.id, status: 'pending', paymentIntentId: intent.id });
}

// The cron sweep finishes an open attempt the webhook did not, or starts one a crash left unstarted.
export async function finishPendingAutoTopup(workspaceId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;
  const attempt = await db.transaction(async (tx) => {
    const row = await lockAutoTopupWorkspace(tx, workspaceId);
    if (!row?.stripeCustomerId) return null;
    const open = await loadOpenAttempt(tx, workspaceId);
    if (!open) return null;
    const { reserved, monthStart } = await reservedThisMonth(tx, workspaceId);
    const canCreate = canCreateAutoTopupPayment({
      enabled: row.autoTopupEnabled,
      paidTier: isPlanTier(row.planTier),
      balance: await deriveWorkspaceCreditBalance(tx, workspaceId),
      thresholdCredits: row.autoTopupThresholdCredits,
      reservedAfterAttemptCents: reservedAfterPendingRetry(
        reserved,
        open.amountCents,
        open.createdAt,
        monthStart,
      ),
      monthlyCapCents: row.autoTopupMonthlyCapCents,
    });
    return {
      ...open,
      workspaceId,
      canCreate,
      customerId: row.stripeCustomerId,
      subscriptionId: row.stripeSubscriptionId,
      organizationId: row.organizationId,
    } satisfies OpenAttempt;
  });
  if (!attempt) return;
  try {
    await finishAttempt(stripe, attempt);
  } catch (error) {
    if (error instanceof Stripe.errors.StripeCardError) {
      await moveAutoTopupAttempt(db, { id: attempt.id, status: 'failed', paymentIntentId: null });
      return;
    }
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Automatic top-up could not be reconciled',
      { workspaceId, attemptId: attempt.id },
      { cause: error },
    );
  }
}

async function finishAttempt(stripe: Stripe, attempt: OpenAttempt): Promise<void> {
  if (attempt.stripePaymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(attempt.stripePaymentIntentId);
    await settleIntent(stripe, attempt, intent);
    return;
  }
  // Inside Stripe's idempotency window a repeated create replays the first answer, so it is safe.
  if (attempt.canCreate && !attempt.pastIdempotencyWindow) {
    await startAttempt(stripe, attempt);
    return;
  }
  // Only a charging attempt can have reached Stripe; a creating one never chose a card.
  if (attempt.status === 'charging') {
    for await (const existing of stripe.paymentIntents.list({
      customer: attempt.customerId,
      created: { gte: Math.floor(attempt.createdAt.getTime() / 1000) - 60 },
      limit: 100,
    })) {
      if (existing.metadata.auto_topup_attempt_id !== attempt.id) continue;
      await moveAutoTopupAttempt(db, {
        id: attempt.id,
        status: 'pending',
        paymentIntentId: existing.id,
      });
      await settleIntent(stripe, attempt, existing);
      return;
    }
    // Keep the reservation while another request can still be creating its payment.
    if (!attempt.pastIdempotencyWindow) return;
  }
  await moveAutoTopupAttempt(db, { id: attempt.id, status: 'superseded' });
}

async function settleIntent(
  stripe: Stripe,
  attempt: OpenAttempt,
  intent: Stripe.PaymentIntent,
): Promise<void> {
  const decision = decideFromIntentStatus(intent.status);
  if (decision === 'charged') {
    await grantTopupAndResume(intent.id, {
      customerId: attempt.customerId,
      credits: attempt.credits,
    });
    await moveAutoTopupAttempt(db, {
      id: attempt.id,
      status: 'succeeded',
      paymentIntentId: intent.id,
    });
  } else if (decision === 'fallback') {
    if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id);
    await moveAutoTopupAttempt(db, {
      id: attempt.id,
      status: 'failed',
      paymentIntentId: intent.id,
    });
  }
}

async function lockAutoTopupWorkspace(tx: BillingTx, workspaceId: string) {
  return (
    await tx
      .select()
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), workspaceNotDeleted))
      .for('update')
  ).at(0);
}

// The partial unique index allows one open attempt per workspace.
async function loadOpenAttempt(tx: Pick<BillingTx, 'select'>, workspaceId: string) {
  return (
    await tx
      .select({
        id: autoTopupAttempt.id,
        status: autoTopupAttempt.status,
        credits: autoTopupAttempt.credits,
        amountCents: autoTopupAttempt.amountCents,
        stripePaymentIntentId: autoTopupAttempt.stripePaymentIntentId,
        paymentMethodId: autoTopupAttempt.paymentMethodId,
        createdAt: autoTopupAttempt.createdAt,
        pastIdempotencyWindow: sql<boolean>`${autoTopupAttempt.createdAt} <= now() - make_interval(hours => ${STRIPE_IDEMPOTENCY_SAFE_HOURS})`,
      })
      .from(autoTopupAttempt)
      .where(and(eq(autoTopupAttempt.workspaceId, workspaceId), openStatus))
  ).at(0);
}

async function hasRecentFailure(tx: BillingTx, workspaceId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: autoTopupAttempt.id })
    .from(autoTopupAttempt)
    .where(
      and(
        eq(autoTopupAttempt.workspaceId, workspaceId),
        inArray(autoTopupAttempt.status, AUTO_TOPUP_COOLDOWN_STATUSES),
        sql`${autoTopupAttempt.updatedAt} >= now() - make_interval(hours => ${AUTO_TOPUP.failedCooldownHours})`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// The month boundary comes from the database clock, the same clock that stamped each attempt.
async function reservedThisMonth(tx: BillingTx, workspaceId: string) {
  const now = await readDatabaseClock(tx);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const row = (
    await tx
      .select({ amount: sql<number>`coalesce(sum(${autoTopupAttempt.amountCents}), 0)::int` })
      .from(autoTopupAttempt)
      .where(
        and(
          eq(autoTopupAttempt.workspaceId, workspaceId),
          gte(autoTopupAttempt.createdAt, monthStart),
          inArray(autoTopupAttempt.status, [...AUTO_TOPUP_OPEN_STATUSES, 'succeeded']),
        ),
      )
  ).at(0);
  return { reserved: row?.amount ?? 0, monthStart };
}
