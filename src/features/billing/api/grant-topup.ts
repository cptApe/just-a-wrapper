// Committed purchases remain granted when realtime or notification delivery fails; budget recovery is scheduled.
// Direct server-module imports keep notification and realtime UI barrels out of the billing graph.

import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { creditGrant, workspace } from '@/db/schema';
import { notify } from '@/features/notifications/api/notify';
import { publishSessionEvent, publishWorkspaceEvent } from '@/features/realtime/api/publish';
import { captureEvent } from '@/lib/analytics';
import { BillingError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { snapshotCtx, withRequestContext } from '@/lib/request-context';
import { requireStripe } from '@/lib/stripe';
import { workspaceOwnerUserId } from '@/lib/workspace-identity';
import { refundDeletedWorkspacePayment } from './refund-deleted-workspace-payment';
import 'server-only';
import type Stripe from 'stripe';
import { topupGrantRef } from '../lib/grant-refs';
import { expiresAtMonthsAfter, TOPUP_CREDIT_EXPIRY_MONTHS } from '../pricing-config';
import { type BillingTx, deriveWorkspaceCreditBalance, issueCreditGrant } from './credit-ledger';
import { lockLedgerWhere } from './ledger-lock';
import { type ResumedSession, resumePausedSessions } from './resume-paused-sessions';
import { syncWorkspaceSessionBudgetsAfterGrant } from './sync-session-budgets';

type CheckoutSessionLike = Pick<Stripe.Checkout.Session, 'id' | 'mode' | 'customer' | 'metadata'>;
type PaymentIntentLike = Pick<Stripe.PaymentIntent, 'id' | 'customer' | 'metadata'>;

export type TopupGrant = { customerId: string; credits: number };

// Checkout and payment-intent webhooks describe the same payment; both must use the intent ID to deduplicate.
export function paymentIntentIdOf(
  checkout: Pick<Stripe.Checkout.Session, 'id' | 'payment_intent'>,
): string {
  const paymentIntent = checkout.payment_intent;
  const id = typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent?.id ?? null);
  if (!id) {
    throw new BillingError('EXTERNAL_API_FAILED', 'top-up checkout has no payment_intent', {
      checkoutSessionId: checkout.id,
    });
  }
  return id;
}

// Metadata is stamped by the purchase API; reading it avoids another line-items request.
export function resolveTopupGrant(checkout: CheckoutSessionLike): TopupGrant {
  if (checkout.mode !== 'payment') {
    throw new BillingError('EXTERNAL_API_FAILED', 'checkout.session is not a one-off top-up', {
      checkoutSessionId: checkout.id,
      mode: checkout.mode,
    });
  }
  const customerId =
    typeof checkout.customer === 'string' ? checkout.customer : (checkout.customer?.id ?? null);
  if (!customerId) {
    throw new BillingError('EXTERNAL_API_FAILED', 'top-up checkout has no customer', {
      checkoutSessionId: checkout.id,
    });
  }
  const raw = checkout.metadata?.credits;
  const credits = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new BillingError('EXTERNAL_API_FAILED', 'top-up checkout carries no credits metadata', {
      checkoutSessionId: checkout.id,
    });
  }
  return { customerId, credits };
}

export function resolveTopupGrantFromIntent(paymentIntent: PaymentIntentLike): TopupGrant {
  const customerId =
    typeof paymentIntent.customer === 'string'
      ? paymentIntent.customer
      : (paymentIntent.customer?.id ?? null);
  if (!customerId) {
    throw new BillingError('EXTERNAL_API_FAILED', 'top-up payment_intent has no customer', {
      paymentIntentId: paymentIntent.id,
    });
  }
  const raw = paymentIntent.metadata.credits;
  const credits = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'top-up payment_intent carries no credits metadata',
      {
        paymentIntentId: paymentIntent.id,
      },
    );
  }
  return { customerId, credits };
}

type AppliedTopup =
  | { kind: 'granted' | 'replayed'; workspaceId: string; organizationId: string; balance: number }
  | { kind: 'refund'; reason: 'deleted-workspace' | 'no-workspace'; workspaceId: string | null };
type GrantedTopup = Extract<AppliedTopup, { kind: 'granted' | 'replayed' }>;

// The grant's source reference is the only de-duplication: a redelivery or a second webhook for the
// same payment finds the grant already issued.
async function applyTopupGrant(paymentIntentId: string, grant: TopupGrant): Promise<AppliedTopup> {
  return db.transaction(async (tx) => {
    const locked = await lockLedgerWhere(
      tx,
      tx
        .select({
          id: workspace.id,
          deletedAt: workspace.deletedAt,
          organizationId: workspace.organizationId,
        })
        .from(workspace)
        .where(eq(workspace.stripeCustomerId, grant.customerId)),
      'update',
    );
    if (!locked) return { kind: 'refund', reason: 'no-workspace', workspaceId: null };
    const { row: target, ledger } = locked;
    const sourceRef = topupGrantRef(paymentIntentId);
    // A purchase granted before the workspace was deleted stays paid; only an unfulfilled one is refunded.
    if (target.deletedAt !== null && !(await hasGrant(tx, target.id, sourceRef)))
      return { kind: 'refund', reason: 'deleted-workspace', workspaceId: target.id };
    const granted =
      target.deletedAt === null &&
      (await issueCreditGrant(ledger, {
        source: 'topup',
        sourceRef,
        amount: grant.credits,
        issuedAt: 'now',
        expiresAt: expiresAtMonthsAfter(ledger.now, TOPUP_CREDIT_EXPIRY_MONTHS),
      }));
    return {
      kind: granted ? 'granted' : 'replayed',
      workspaceId: target.id,
      organizationId: target.organizationId,
      // The transaction clock makes the purchase spendable in the balance this transaction reports.
      balance: await deriveWorkspaceCreditBalance(tx, target.id),
    };
  });
}

async function hasGrant(tx: BillingTx, workspaceId: string, sourceRef: string) {
  const rows = await tx
    .select({ id: creditGrant.id })
    .from(creditGrant)
    .where(and(eq(creditGrant.workspaceId, workspaceId), eq(creditGrant.sourceRef, sourceRef)))
    .limit(1);
  return rows.length > 0;
}

export type TopupResult =
  | (GrantedTopup & { resumedSessionIds: string[] })
  | { kind: 'refunded'; reason: 'deleted-workspace' | 'no-workspace'; workspaceId: string | null };

// A paid intent whose workspace is gone, or whose customer maps to no workspace, is refunded and
// reported, never retried forever and never dropped.
// Replay still runs resume: a delivery can commit credits and crash before waking paused sessions.
export async function grantTopupAndResume(
  paymentIntentId: string,
  grant: TopupGrant,
): Promise<TopupResult> {
  const applied = await applyTopupGrant(paymentIntentId, grant);
  if (applied.kind === 'refund') {
    const stripe = requireStripe();
    await refundDeletedWorkspacePayment(stripe, paymentIntentId);
    if (applied.reason === 'no-workspace')
      captureException(
        new BillingError(
          'WORKSPACE_NOT_FOUND',
          'Refunded a top-up from a customer with no workspace',
          { paymentIntentId, customerId: grant.customerId, defect: 'unmapped-customer-payment' },
        ),
      );
    return { kind: 'refunded', reason: applied.reason, workspaceId: applied.workspaceId };
  }
  const resumed = await resumePausedSessions(applied.workspaceId, { budgetRaisedSessionIds: [] });
  scheduleTopupBudgetRecovery(applied);

  await publishTopupState(applied, resumed).catch((error) =>
    captureException(error, { feature: 'billing', op: 'topup-publish' }),
  );

  if (applied.kind === 'granted') {
    const ownerUserId = await workspaceOwnerUserId(applied.workspaceId);
    captureEvent(
      'billing:topup_purchase',
      {
        credits: grant.credits,
        balance_after: applied.balance,
        payment_intent_id: paymentIntentId,
        resumed_session_count: resumed.length,
      },
      { userId: ownerUserId, workspaceId: applied.workspaceId },
    );
    await notify('topup.granted', {
      organizationId: applied.organizationId,
      idempotencyKey: `topup:${paymentIntentId}`,
      data: { credits: grant.credits, balance: applied.balance, title: 'Credits added' },
    }).catch((error) => captureException(error, { feature: 'billing', op: 'topup-notify' }));
  }

  return { ...applied, resumedSessionIds: resumed.map((r) => r.sessionId) };
}

/** The webhook body fields every top-up handler reports. */
export function topupResultBody(result: TopupResult): Record<string, unknown> {
  if (result.kind === 'refunded')
    return { workspaceId: result.workspaceId, applied: false, ignored: result.reason, resumed: 0 };
  return {
    workspaceId: result.workspaceId,
    balance: result.balance,
    applied: result.kind === 'granted',
    resumed: result.resumedSessionIds.length,
  };
}

// Request-lifetime scheduling keeps grant-wide budget recovery alive after the response.
function scheduleTopupBudgetRecovery(applied: GrantedTopup): void {
  try {
    const snapshot = snapshotCtx();
    after(() =>
      withRequestContext(snapshot, async () => {
        const budgetSync = await syncWorkspaceSessionBudgetsAfterGrant(applied.workspaceId);
        const resumed = await resumePausedSessions(applied.workspaceId, {
          budgetRaisedSessionIds: budgetSync.updatedSessionIds,
        });
        await publishResumedSessionStates(applied.organizationId, resumed);
      }),
    );
  } catch (error) {
    captureException(error, { feature: 'billing', op: 'schedule-topup-budget-recovery' });
  }
}

async function publishTopupState(applied: GrantedTopup, resumed: ResumedSession[]): Promise<void> {
  await Promise.allSettled([
    publishWorkspaceEvent(applied.organizationId, {
      type: 'credits',
      balance: applied.balance,
    }),
    publishResumedSessionStates(applied.organizationId, resumed),
  ]);
}

// Session status follows each session's privacy channel; the pooled balance stays workspace-wide.
async function publishResumedSessionStates(
  organizationId: string,
  resumed: ResumedSession[],
): Promise<void> {
  await Promise.allSettled(
    resumed.map((row) =>
      publishSessionEvent(
        { type: 'session_status', sessionId: row.sessionId, status: 'running' },
        {
          organizationId,
          session: { visibility: row.visibility, createdByUserId: row.createdByUserId },
        },
      ),
    ),
  );
}
