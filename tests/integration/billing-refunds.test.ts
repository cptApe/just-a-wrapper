// Refunds and disputes on the real ledger: credits removed match the money returned, replays are harmless, won disputes restore only what can be restored.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { creditGrant, workspace } from '@/db/schema';
import { retireCreditGrants } from '@/features/billing/api/credit-grant-transitions';
import {
  consumeWorkspaceCredits,
  getLiveCreditBalance,
  issueCreditGrant,
  retireFuturePlanGrants,
} from '@/features/billing/api/credit-ledger';
import { findPaymentGrants } from '@/features/billing/api/find-payment-grants';
import { grantProration } from '@/features/billing/api/grant-proration';
import { handleChargeReversal } from '@/features/billing/api/handle-charge-reversal';
import { handleInvoicePaid } from '@/features/billing/api/handle-invoice-paid';
import { reversePaymentGrant } from '@/features/billing/api/reverse-payment-grants';
import { getStripe } from '@/lib/stripe';
import { balanceAt, seedCreditBalance, withLockedLedger } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const network = vi.hoisted(() => ({
  charge: vi.fn(),
  disputes: vi.fn(),
  retrieve: vi.fn(),
  refundList: vi.fn(),
  invoicePayments: vi.fn(),
  invoice: vi.fn(),
  retrieveIntent: vi.fn(),
}));
vi.mock('@/lib/stripe', async (original) => {
  const getStripe = () => ({
    charges: { retrieve: network.charge },
    disputes: { list: network.disputes },
    subscriptions: { retrieve: network.retrieve },
    refunds: { list: network.refundList },
    invoicePayments: { list: network.invoicePayments },
    invoices: { retrieve: network.invoice },
    paymentIntents: { retrieve: network.retrieveIntent },
  });
  return {
    ...(await original<typeof import('@/lib/stripe')>()),
    getStripe,
    requireStripe: getStripe,
  };
});
vi.mock('next/server', () => ({ after: () => {} }));
const pool = makeTestPool();
const database = makeTestDb(pool);
let workspaceId: string;
beforeAll(() => applyMigrations(database));
afterAll(() => pool.end());
beforeEach(async () => {
  vi.resetAllMocks();
  await truncateAll(database);
  await seedOrganization(database, 'refunds');
  workspaceId = randomUUID();
  await database.insert(workspace).values({
    id: workspaceId,
    organizationId: 'refunds',
    name: 'Refunds',
    stripeCustomerId: 'cus_recovery',
    stripeSubscriptionId: 'sub_recovery',
    planTier: 'pro',
    planBillingInterval: 'month',
    planCredits: 1000,
  });
  network.refundList.mockImplementation(async function* () {
    const charge = await network.charge();
    yield { amount: charge.amount_refunded, status: 'succeeded' };
  });
  network.invoicePayments.mockImplementation(async function* () {
    yield { id: 'inpay_paid', payment: { payment_intent: 'pi_paid' } };
  });
  network.retrieveIntent.mockResolvedValue({ id: 'pi_paid', latest_charge: { refunded: false } });
  network.retrieve.mockResolvedValue({
    id: 'sub_recovery',
    status: 'active',
    latest_invoice: 'in_paid',
  });
});

function stripeClient() {
  const stripe = getStripe();
  if (!stripe) throw new Error('Missing test Stripe client');
  return stripe;
}

async function paidInvoice() {
  // constructEvent validates the envelope without hand-copying the Stripe invoice type.
  const { default: Stripe } = await import('stripe');
  const client = new Stripe('sk_test_offline');
  const payload = JSON.stringify({
    id: 'evt_paid',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_paid',
        customer: 'cus_recovery',
        amount_paid: 2000,
        billing_reason: 'subscription_create',
        parent: { subscription_details: { subscription: 'sub_recovery' } },
        lines: {
          data: [
            {
              quantity: 1,
              period: {
                start: Math.floor(Date.now() / 1000),
                end: Math.floor(Date.now() / 1000) + 30 * 86400,
              },
              pricing: {
                price_details: {
                  price: {
                    id: 'price_plan',
                    metadata: {
                      kind: 'plan',
                      tier: 'pro',
                      interval: 'month',
                      credits: '1000',
                      block_credits: '1000',
                    },
                    recurring: { interval: 'month' },
                  },
                },
              },
            },
          ],
        },
      },
    },
  });
  const secret = 'whsec_offline';
  const signature = client.webhooks.generateTestHeaderString({ payload, secret });
  const event = client.webhooks.constructEvent(payload, signature, secret);
  if (event.type !== 'invoice.paid') throw new Error('Expected invoice');
  return event;
}

async function reversalEvent(
  type: 'charge.refunded' | 'charge.dispute.closed' | 'refund.failed' | 'refund.updated',
  id: string,
) {
  const { default: Stripe } = await import('stripe');
  const client = new Stripe('sk_test_offline');
  const object =
    type === 'charge.refunded'
      ? { object: 'charge', id: 'ch_reversed', customer: 'cus_recovery' }
      : {
          object: type.startsWith('refund.') ? 'refund' : 'dispute',
          id: 'reversed',
          charge: 'ch_reversed',
        };
  const payload = JSON.stringify({ id, type, data: { object } });
  const secret = 'whsec_offline';
  const event = client.webhooks.constructEvent(
    payload,
    client.webhooks.generateTestHeaderString({ payload, secret }),
    secret,
  );
  if (
    event.type !== 'charge.refunded' &&
    event.type !== 'charge.dispute.closed' &&
    event.type !== 'refund.failed' &&
    event.type !== 'refund.updated'
  )
    throw new Error('Expected reversal');
  return event;
}

async function reverseCharge(
  type: Parameters<typeof reversalEvent>[0],
  id: string,
): Promise<{ status: number }> {
  return handleChargeReversal(stripeClient(), await reversalEvent(type, id));
}

function chargeOf(amountRefunded: number, paymentIntent = 'pi_reversed', kind?: string) {
  return {
    id: 'ch_reversed',
    customer: 'cus_recovery',
    payment_intent: paymentIntent,
    amount: 2000,
    amount_refunded: amountRefunded,
    metadata: kind ? { kind } : {},
  };
}

// A 1,000-credit top-up bought for $20 with 600 credits spent; Stripe reports $5 refunded.
async function seedReversedPurchase() {
  await database.insert(creditGrant).values({
    workspaceId,
    source: 'topup',
    sourceRef: 'stripe:pi_reversed',
    issuedAt: new Date(Date.now() - 86400_000),
    amount: 1000,
    consumed: 600,
    expiresAt: new Date(Date.now() + 86400_000),
  });
  network.invoicePayments.mockImplementation(async function* () {});
  network.disputes.mockImplementation(async function* () {});
  network.charge.mockResolvedValue(chargeOf(500, 'pi_reversed', 'topup'));
}

describe('Stripe refund and dispute events', () => {
  test('a partial refund removes its share, a full refund turns spent credits into debt, and a replay removes nothing more', async () => {
    await seedReversedPurchase();
    await reverseCharge('charge.refunded', 'evt_partial');
    expect(await getLiveCreditBalance(workspaceId)).toBe(150);
    await reverseCharge('charge.refunded', 'evt_partial');
    expect(await getLiveCreditBalance(workspaceId)).toBe(150);

    network.charge.mockResolvedValue(chargeOf(2000, 'pi_reversed', 'topup'));
    await reverseCharge('charge.refunded', 'evt_full');
    expect(await getLiveCreditBalance(workspaceId)).toBe(-600);
    expect(
      (await database.select().from(creditGrant)).some((grant) =>
        grant.sourceRef.startsWith('debt:refund:ch_reversed:'),
      ),
    ).toBe(true);
  });

  test('a lost dispute removes the credits, a won one restores them, and a stale delivery reads the current state', async () => {
    await seedReversedPurchase();
    network.charge.mockResolvedValue(chargeOf(0, 'pi_reversed', 'topup'));
    network.disputes.mockImplementation(async function* () {
      yield { status: 'lost', amount: 2000 };
    });
    await reverseCharge('charge.dispute.closed', 'evt_lost');
    expect(await getLiveCreditBalance(workspaceId)).toBe(-600);

    network.disputes.mockImplementation(async function* () {
      yield { status: 'won', amount: 2000 };
    });
    await reverseCharge('charge.dispute.closed', 'evt_won');
    expect(await getLiveCreditBalance(workspaceId)).toBe(400);
    await reverseCharge('charge.dispute.closed', 'evt_stale');
    expect(await getLiveCreditBalance(workspaceId)).toBe(400);
  });

  test.each([
    'warning_needs_response',
    'warning_under_review',
  ])('a dispute inquiry (%s) removes no credits before the money moves', async (status) => {
    await seedReversedPurchase();
    network.charge.mockResolvedValue(chargeOf(0, 'pi_reversed', 'topup'));
    network.disputes.mockImplementation(async function* () {
      yield { status, amount: 2000 };
    });
    await reverseCharge('charge.dispute.closed', 'evt_inquiry');
    expect(await getLiveCreditBalance(workspaceId)).toBe(400);
  });

  test('a refund plus a lost dispute on the rest removes the whole purchase', async () => {
    await seedReversedPurchase();
    network.disputes.mockImplementation(async function* () {
      yield { status: 'lost', amount: 1500 };
    });
    await reverseCharge('charge.dispute.closed', 'evt_mixed');
    expect(await getLiveCreditBalance(workspaceId)).toBe(-600);
  });

  test.each([
    'refund.failed',
    'refund.updated',
  ] as const)('%s gives back credits for a refund that failed, even when the charge looks unchanged', async (type) => {
    await seedReversedPurchase();
    await reverseCharge('charge.refunded', 'evt_initial');
    expect(await getLiveCreditBalance(workspaceId)).toBe(150);
    network.refundList.mockImplementation(async function* () {
      yield { amount: 500, status: 'failed' };
    });
    network.charge.mockClear();
    await reverseCharge(type, 'evt_failed');
    expect(await getLiveCreditBalance(workspaceId)).toBe(400);
    expect(network.charge).toHaveBeenCalledOnce();
  });

  test('refunding a yearly invoice retires every scheduled monthly bucket', async () => {
    const event = await paidInvoice();
    const line = event.data.object.lines.data[0];
    const price = line?.pricing?.price_details?.price;
    if (!line || !price || typeof price === 'string' || !price.recurring)
      throw new Error('Missing price');
    price.recurring.interval = 'year';
    price.metadata.interval = 'year';
    line.period.end = line.period.start + 365 * 86400;
    await handleInvoicePaid(stripeClient(), event.data.object);
    network.charge.mockResolvedValue(chargeOf(2000, 'pi_paid'));
    network.disputes.mockImplementation(async function* () {});
    network.invoice.mockResolvedValue(event.data.object);
    network.invoicePayments.mockImplementation(async function* () {
      yield { invoice: 'in_paid' };
    });
    await reverseCharge('charge.refunded', 'evt_annual_refund');
    const grants = await database.select().from(creditGrant);
    expect(grants.filter((grant) => grant.source === 'plan')).toHaveLength(12);
    expect(grants.every((grant) => grant.status === 'retired')).toBe(true);
  });

  // A refund with no grant behind it must be acknowledged, or Stripe retries it forever.
  test('a refund of an invoice that granted no credits is acknowledged', async () => {
    await seedReversedPurchase();
    await database.delete(creditGrant);
    network.charge.mockResolvedValue(chargeOf(2000));
    network.invoicePayments.mockImplementation(async function* () {
      yield { invoice: 'in_unrelated' };
    });
    network.invoice.mockResolvedValue({ id: 'in_unrelated', amount_paid: 2000, parent: null });
    expect((await reverseCharge('charge.refunded', 'evt_unrelated')).status).toBe(200);
  });

  test('a refund of a zero-credit proration invoice is acknowledged', async () => {
    const event = await paidInvoice();
    // A mid-cycle change whose paid amount buys no credit leaves no grant to wait for.
    event.data.object.billing_reason = 'subscription_update';
    event.data.object.amount_paid = 0;
    network.charge.mockResolvedValue({ ...chargeOf(1, 'pi_paid'), amount: 1 });
    network.disputes.mockImplementation(async function* () {});
    network.invoice.mockResolvedValue(event.data.object);
    network.invoicePayments.mockImplementation(async function* () {
      yield { invoice: 'in_paid' };
    });
    expect((await reverseCharge('charge.refunded', 'evt_zero')).status).toBe(200);
  });
});

describe('reversal arithmetic on the ledger', () => {
  beforeEach(async () => {
    await database
      .update(workspace)
      .set({ planBillingInterval: 'year', planCredits: 100 })
      .where(eq(workspace.id, workspaceId));
  });

  async function purchase(status: 'issued' | 'retired', expiresAt: Date, consumed: number) {
    const [grant] = await database
      .insert(creditGrant)
      .values({
        workspaceId,
        source: 'plan',
        sourceRef: 'plan-invoice:original:0',
        amount: 100,
        consumed,
        status,
        issuedAt: new Date(Date.now() - 86400000),
        expiresAt,
      })
      .returning();
    if (!grant) throw new Error('Missing purchase');
    return grant;
  }

  async function reverse(grant: typeof creditGrant.$inferSelect, removedFraction: number) {
    const target = await database.query.workspace.findFirst({
      where: eq(workspace.id, workspaceId),
    });
    if (!target) throw new Error('Missing workspace');
    await withLockedLedger(database, workspaceId, (ledger) =>
      reversePaymentGrant(ledger, {
        grant,
        planActive: target.stripeSubscriptionId !== null,
        chargeId: 'charge-original',
        removedFraction,
      }),
    );
  }

  test.each([
    'retired',
    'expired',
  ] as const)('winning a dispute never revives %s unused credits', async (unavailable) => {
    const grant = await purchase(
      unavailable === 'retired' ? 'retired' : 'issued',
      new Date(Date.now() + (unavailable === 'expired' ? -1000 : 86400000)),
      0,
    );
    await reverse(grant, 1);
    await reverse(grant, 0);
    expect(await getLiveCreditBalance(workspaceId)).toBe(0);
  });

  // 0, under half and over half of the purchase spent take different paths through the half refund.
  test.each([
    0, 20, 80,
  ])('refunding retired credits creates debt only for the %i already spent', async (consumed) => {
    const grant = await purchase('retired', new Date(Date.now() + 86400000), consumed);
    await reverse(grant, 0.5);
    await reverse(grant, 1);
    expect(await getLiveCreditBalance(workspaceId)).toBe(0 - consumed);
    await reverse(grant, 0);
    expect(await getLiveCreditBalance(workspaceId)).toBe(0);
  });

  test.each([
    'original',
    'upgrade',
  ])('refunding the %s invoice of an upgraded yearly plan removes only that purchase', async (invoiceId) => {
    await database.insert(creditGrant).values({
      workspaceId,
      source: 'plan',
      sourceRef: 'plan-invoice:original:1',
      amount: 100,
      issuedAt: new Date(Date.now() + 86400000),
      expiresAt: new Date(Date.now() + 32 * 86400000),
    });
    const upgrade = await withLockedLedger(database, workspaceId, (ledger) =>
      grantProration(ledger, {
        invoiceId: 'upgrade',
        paidCents: 100,
        interval: 'year',
        expiryMonths: 1,
      }),
    );
    await withLockedLedger(database, workspaceId, async (ledger) => {
      const grants = await findPaymentGrants(ledger.tx, {
        workspaceId,
        paymentIntentId: null,
        chargeAmount: 100,
        invoices: [{ id: invoiceId, amountPaid: 100 }],
      });
      for (const { grant } of grants)
        await reversePaymentGrant(ledger, {
          grant,
          planActive: true,
          chargeId: `charge-${invoiceId}`,
          removedFraction: 1,
        });
    });
    const live = (
      await database.select().from(creditGrant).where(eq(creditGrant.workspaceId, workspaceId))
    ).filter((grant) => grant.status === 'issued');
    expect(live.reduce((sum, grant) => sum + grant.amount - grant.consumed, 0)).toBe(
      invoiceId === 'original' ? upgrade : 100,
    );
  });

  // 60 of the purchase was spent before the first dispute; another purchase repays that debt in between.
  test.each([
    0, 30, 80,
  ])('a repeated dispute after another purchase repaid the debt keeps only the %i spent since as debt', async (spent) => {
    const grant = await purchase('issued', new Date(Date.now() + 86400000), 60);
    await reverse(grant, 1);
    await withLockedLedger(database, workspaceId, (ledger) =>
      issueCreditGrant(ledger, {
        source: 'topup',
        sourceRef: 'separate-purchase',
        amount: 60,
        issuedAt: 'now',
        expiresAt: new Date(Date.now() + 86400000),
      }),
    );
    await reverse(grant, 0);
    expect(await getLiveCreditBalance(workspaceId)).toBe(100);
    if (spent > 0)
      await database.transaction((tx) =>
        consumeWorkspaceCredits(tx, { workspaceId, credits: spent }),
      );
    await reverse(grant, 1);
    expect(await getLiveCreditBalance(workspaceId)).toBe(0 - spent);
    const grants = await database.select().from(creditGrant);
    expect(
      grants
        .filter((row) => row.source === 'debt')
        .reduce((sum, row) => sum + row.consumed - row.amount, 0),
    ).toBe(spent);
    expect(
      grants.filter(
        (row) => row.status === 'issued' && row.source !== 'debt' && row.amount > row.consumed,
      ),
    ).toEqual([]);
  });

  test.each([
    'expired',
    'canceled',
  ] as const)('a later reversal cannot restore an earlier partial refund once the rest is %s', async (unavailable) => {
    const grant = await purchase('issued', new Date(Date.now() + 86400000), 0);
    await reverse(grant, 0.4);
    expect(await getLiveCreditBalance(workspaceId)).toBe(60);
    if (unavailable === 'expired') {
      await database.update(creditGrant).set({ expiresAt: new Date(Date.now() - 1000) });
    } else {
      await withLockedLedger(database, workspaceId, (ledger) =>
        retireCreditGrants(ledger, eq(creditGrant.source, 'plan')),
      );
    }
    await reverse(grant, 1);
    expect(await getLiveCreditBalance(workspaceId)).toBe(0);
    await reverse(grant, 0.4);
    expect(await getLiveCreditBalance(workspaceId)).toBe(0);
  });

  test('winning a yearly dispute after cancellation cannot restore the current and future months', async () => {
    const now = Date.now();
    const grants = await database
      .insert(creditGrant)
      .values(
        Array.from({ length: 9 }, (_, month) => ({
          workspaceId,
          source: 'plan' as const,
          sourceRef: `plan-invoice:yearly:${month + 3}`,
          amount: 100,
          issuedAt: new Date(now + month * 30 * 86400000 - 1000),
          expiresAt: new Date(now + (month + 1) * 30 * 86400000),
        })),
      )
      .returning();
    for (const grant of grants) await reverse(grant, 1);
    await withLockedLedger(database, workspaceId, async (ledger) => {
      await retireFuturePlanGrants(ledger);
      await retireCreditGrants(ledger, eq(creditGrant.source, 'plan'));
      await ledger.tx
        .update(workspace)
        .set({
          stripeSubscriptionId: null,
          planTier: 'none',
          planCredits: null,
          planBillingInterval: null,
        })
        .where(eq(workspace.id, workspaceId));
    });
    for (const grant of grants) await reverse(grant, 0);
    expect(await getLiveCreditBalance(workspaceId)).toBe(0);
    const remaining = await database
      .select()
      .from(creditGrant)
      .where(eq(creditGrant.status, 'issued'));
    expect(remaining.reduce((sum, grant) => sum + grant.amount - grant.consumed, 0)).toBe(0);
  });

  test('cancelling after a 25 percent refund keeps the 50 debt a future month was holding', async () => {
    await seedCreditBalance(database, workspaceId, -50);
    const future = new Date(Date.now() + 86400000);
    await withLockedLedger(database, workspaceId, (ledger) =>
      issueCreditGrant(ledger, {
        source: 'plan',
        sourceRef: 'plan-invoice:future:0',
        amount: 100,
        issuedAt: future,
        expiresAt: new Date(Date.now() + 32 * 86400000),
      }),
    );
    const grant = await database.query.creditGrant.findFirst({
      where: eq(creditGrant.source, 'plan'),
    });
    if (!grant) throw new Error('Missing future bucket');
    expect(grant.consumed).toBe(50);
    await reverse(grant, 0.25);
    await withLockedLedger(database, workspaceId, (ledger) => retireFuturePlanGrants(ledger));
    await withLockedLedger(database, workspaceId, (ledger) => retireFuturePlanGrants(ledger));
    expect(await balanceAt(database, workspaceId, new Date(future.getTime() + 1000))).toBe(-50);
    const debts = await database.select().from(creditGrant).where(eq(creditGrant.source, 'debt'));
    const hold = debts.find((row) => row.debtKind === 'hold');
    expect(hold?.parentGrantId).toBe(grant.id);
    for (const restored of debts.filter((row) => row.debtKind === 'restored'))
      expect(restored.parentGrantId).toBe(hold?.id);
  });
});
