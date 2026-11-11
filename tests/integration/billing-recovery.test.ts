// Billing recovery on real Postgres: payments for deleted workspaces are refunded, deletion stops Stripe billing, and the billing cron and refreshes finish half-done work.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { autoTopupAttempt, creditGrant, session, usageEvent, workspace } from '@/db/schema';
import { grantTopupAndResume } from '@/features/billing/api/grant-topup';
import { handleInvoicePaid } from '@/features/billing/api/handle-invoice-paid';
import { finishPendingAutoTopup } from '@/features/billing/api/maybe-auto-topup';
import { reconcileCurrentSubscription } from '@/features/billing/api/reconcile-stripe';
import { stopDeletedWorkspaceBilling } from '@/features/billing/api/subscription-transitions';
import { completeUnloadedUsageSettlement } from '@/features/billing/api/usage-settlement-transitions';
import { runBillingRecovery } from '@/features/jobs/api/billing-recovery';
import { finishDeletingWorkspaces } from '@/features/workspaces/api/purge-expired';
import { getStripe } from '@/lib/stripe';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const network = vi.hoisted(() => ({
  retrieve: vi.fn(),
  cancel: vi.fn(),
  list: vi.fn(),
  intents: vi.fn(),
  retrieveIntent: vi.fn(),
  createIntent: vi.fn(),
  refund: vi.fn(),
  invoicePayments: vi.fn(),
  invoice: vi.fn(),
  checkouts: vi.fn(),
  expire: vi.fn(),
}));
vi.mock('@/lib/stripe', async (original) => {
  const getStripe = () => ({
    subscriptions: { retrieve: network.retrieve, cancel: network.cancel, list: network.list },
    paymentIntents: {
      list: network.intents,
      retrieve: network.retrieveIntent,
      create: network.createIntent,
    },
    refunds: { create: network.refund },
    invoicePayments: { list: network.invoicePayments },
    invoices: { retrieve: network.invoice },
    checkout: { sessions: { list: network.checkouts, expire: network.expire } },
  });
  return {
    ...(await original<typeof import('@/lib/stripe')>()),
    getStripe,
    requireStripe: getStripe,
  };
});
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, { CRON_SECRET: 'billing-test' }),
);
vi.mock('next/server', () => ({ after: () => {} }));
const { GET: billingCron } = await import('@/app/api/cron/billing/route');
const pool = makeTestPool();
const database = makeTestDb(pool);
let workspaceId: string;
beforeAll(() => applyMigrations(database));
afterAll(() => pool.end());
beforeEach(async () => {
  vi.resetAllMocks();
  await truncateAll(database);
  await seedOrganization(database, 'recovery');
  workspaceId = randomUUID();
  await database.insert(workspace).values({
    id: workspaceId,
    organizationId: 'recovery',
    name: 'Recovery',
    stripeCustomerId: 'cus_recovery',
    stripeSubscriptionId: 'sub_recovery',
    planTier: 'pro',
    planBillingInterval: 'month',
    planCredits: 1000,
    autoTopupEnabled: true,
  });
  network.intents.mockImplementation(async function* () {});
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

async function deliverPaidInvoice() {
  return handleInvoicePaid(stripeClient(), (await paidInvoice()).data.object);
}

function markDeleted(lifecycleStatus: 'deleting' | 'deleted' = 'deleted') {
  return database
    .update(workspace)
    .set({ deletedAt: new Date(), lifecycleStatus })
    .where(eq(workspace.id, workspaceId));
}

async function billingWorkspace() {
  const row = (await database.select().from(workspace)).at(0);
  if (!row) throw new Error('Expected workspace');
  return { ...row, userEmail: 'test@example.test', userId: 'test', creditBalance: 0 };
}

describe('payments that reach a deleted workspace', () => {
  test('a plan invoice cancels the subscription and is refunded without granting', async () => {
    await markDeleted();
    const result = await deliverPaidInvoice();
    expect(result.body.ignored).toBe('deleted-workspace');
    expect(network.cancel).toHaveBeenCalledWith(
      'sub_recovery',
      {},
      { idempotencyKey: 'cancel-deleted-workspace:sub_recovery' },
    );
    expect(network.refund).toHaveBeenCalledWith(
      { payment_intent: 'pi_paid' },
      { idempotencyKey: 'refund-deleted-workspace:pi_paid' },
    );
    expect(await database.select().from(creditGrant)).toEqual([]);
  });

  test('a workspace deleted while Stripe is being read is refunded the same way', async () => {
    network.retrieve.mockImplementation(async () => {
      await markDeleted();
      return { id: 'sub_recovery', status: 'active', latest_invoice: 'in_paid' };
    });
    expect((await deliverPaidInvoice()).body.ignored).toBe('deleted-workspace');
    expect(network.refund).toHaveBeenCalledOnce();
  });

  test('an invoice payment Stripe recorded outside a payment intent does not block refunding the rest', async () => {
    await markDeleted();
    network.invoicePayments.mockImplementation(async function* () {
      yield { id: 'inpay_external', payment: { type: 'payment_record' } };
      yield { id: 'inpay_paid', payment: { payment_intent: 'pi_paid' } };
    });
    expect((await deliverPaidInvoice()).status).toBe(200);
    expect(network.refund).toHaveBeenCalledOnce();
  });

  test('a top-up is refunded once, and a replay after the refund grants and refunds nothing', async () => {
    await markDeleted();
    const result = await grantTopupAndResume('pi_paid', {
      customerId: 'cus_recovery',
      credits: 1000,
    });
    expect(result).toMatchObject({ kind: 'refunded', reason: 'deleted-workspace' });
    network.retrieveIntent.mockResolvedValue({ latest_charge: { refunded: true } });
    await grantTopupAndResume('pi_paid', { customerId: 'cus_recovery', credits: 1000 });
    expect(network.refund).toHaveBeenCalledOnce();
    expect(await database.select().from(creditGrant)).toEqual([]);
  });

  test('a refund Stripe refuses fails the delivery so Stripe retries it', async () => {
    await markDeleted();
    network.refund.mockRejectedValue(new Error('Stripe unavailable'));
    await expect(
      grantTopupAndResume('pi_paid', { customerId: 'cus_recovery', credits: 1000 }),
    ).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
  });

  test.each([
    'deleting',
    'deleted',
  ] as const)('an invoice already granted is not refunded when redelivered after the workspace is %s', async (lifecycleStatus) => {
    const event = await paidInvoice();
    await handleInvoicePaid(stripeClient(), event.data.object);
    expect(await database.select().from(creditGrant)).toHaveLength(1);
    await markDeleted(lifecycleStatus);
    await handleInvoicePaid(stripeClient(), event.data.object);
    expect(network.cancel).toHaveBeenCalled();
    expect(network.refund).not.toHaveBeenCalled();
    expect(await database.select().from(creditGrant)).toHaveLength(1);
  });

  test.each([
    'deleting',
    'deleted',
  ] as const)('a top-up already granted is not refunded when redelivered after the workspace is %s', async (lifecycleStatus) => {
    const grant = { customerId: 'cus_recovery', credits: 1000 };
    expect((await grantTopupAndResume('pi_paid', grant)).kind).toBe('granted');
    await markDeleted(lifecycleStatus);
    expect(await grantTopupAndResume('pi_paid', grant)).toMatchObject({ kind: 'replayed' });
    expect(network.refund).not.toHaveBeenCalled();
    expect(await database.select().from(creditGrant)).toHaveLength(1);
  });
});

describe('deleting a workspace stops its Stripe billing', () => {
  test('every open Checkout is expired and every live subscription cancelled', async () => {
    network.checkouts.mockImplementation(async function* () {
      yield { id: 'cs_plan' };
      yield { id: 'cs_topup' };
    });
    network.list.mockImplementation(async function* () {
      yield { id: 'sub_open', status: 'active' };
      yield { id: 'sub_unpaid', status: 'unpaid' };
      yield { id: 'sub_ended', status: 'canceled' };
    });
    await stopDeletedWorkspaceBilling(stripeClient(), 'cus_recovery');
    expect(network.expire.mock.calls.map((call) => call[0])).toEqual(['cs_plan', 'cs_topup']);
    expect(network.cancel.mock.calls.map((call) => call[0])).toEqual(['sub_open', 'sub_unpaid']);
  });

  test('a Stripe customer that no longer exists does not block finishing the deletion', async () => {
    network.checkouts.mockImplementation(async function* () {
      throw Object.assign(new Error('No such customer'), { code: 'resource_missing' });
    });
    await expect(
      stopDeletedWorkspaceBilling(stripeClient(), 'cus_missing'),
    ).resolves.toBeUndefined();
  });

  test('a deletion that fails to cancel in Stripe stays pending and the retry finishes it', async () => {
    await database
      .update(workspace)
      .set({
        lifecycleStatus: 'deleting',
        deletedAt: new Date(),
        stripeSubscriptionId: null,
        planTier: 'none',
        planBillingInterval: null,
        planCredits: null,
        autoTopupEnabled: false,
      })
      .where(eq(workspace.id, workspaceId));
    network.checkouts.mockImplementation(async function* () {
      yield { id: 'cs_abandoned' };
    });
    network.list.mockImplementation(async function* () {
      yield { id: 'sub_unbound', status: 'active' };
    });
    network.cancel.mockRejectedValueOnce(new Error('Stripe unavailable'));
    const scope = { kind: 'workspaces' as const, ids: [workspaceId] };
    const first = await finishDeletingWorkspaces(Date.now() + 60_000, scope);
    expect(first.failed).toHaveLength(1);
    expect((await database.select().from(workspace)).at(0)?.lifecycleStatus).toBe('deleting');
    const retry = await finishDeletingWorkspaces(Date.now() + 60_000, scope);
    expect(retry.deleted).toBe(1);
    expect(network.expire).toHaveBeenCalledWith('cs_abandoned');
    expect(network.cancel).toHaveBeenCalledWith(
      'sub_unbound',
      {},
      { idempotencyKey: 'cancel-deleted-workspace:sub_unbound' },
    );
  });
});

describe('plan invoices handled directly', () => {
  test('two concurrent fulfilments of one invoice both succeed and grant once', async () => {
    const event = await paidInvoice();
    const results = await Promise.all([
      handleInvoicePaid(stripeClient(), event.data.object),
      handleInvoicePaid(stripeClient(), event.data.object),
    ]);
    expect(results.every((result) => result.status === 200)).toBe(true);
    expect(results.filter((result) => result.body.idempotent === true)).toHaveLength(1);
    expect(await database.select().from(creditGrant)).toHaveLength(1);
  });

  test('an invoice for a subscription that has already ended issues its credits as retired', async () => {
    network.retrieve.mockResolvedValue({
      id: 'sub_recovery',
      status: 'canceled',
      latest_invoice: 'in_paid',
    });
    await deliverPaidInvoice();
    expect((await database.select().from(creditGrant)).map((grant) => grant.status)).toEqual([
      'retired',
    ]);
  });

  test('a second live subscription delivers what was paid and is cancelled, keeping the first', async () => {
    await database
      .update(workspace)
      .set({ stripeSubscriptionId: 'sub_original' })
      .where(eq(workspace.id, workspaceId));
    network.retrieve.mockImplementation(async (id: string) => ({
      id,
      status: 'active',
      latest_invoice: 'in_paid',
    }));
    await deliverPaidInvoice();
    expect(network.cancel).toHaveBeenCalledWith(
      'sub_recovery',
      {},
      { idempotencyKey: 'cancel-duplicate-subscription:sub_recovery' },
    );
    expect((await database.select().from(workspace)).at(0)?.stripeSubscriptionId).toBe(
      'sub_original',
    );
    expect((await database.select().from(creditGrant)).at(0)).toMatchObject({
      amount: 1000,
      status: 'issued',
    });
  });

  test.each([
    'month',
    'year',
  ] as const)('a %s invoice delivered after its period still grants credits that expire in the future', async (interval) => {
    const event = await paidInvoice();
    const line = event.data.object.lines.data[0];
    if (!line) throw new Error('Missing invoice line');
    line.period = {
      start: Math.floor(Date.now() / 1000) - 65 * 86400,
      end: Math.floor(Date.now() / 1000) - 35 * 86400,
    };
    const price = line.pricing?.price_details?.price;
    if (!price || typeof price === 'string' || !price.recurring) throw new Error('Missing price');
    price.recurring.interval = interval;
    price.metadata.interval = interval;
    await handleInvoicePaid(stripeClient(), event.data.object);
    const grants = await database.select().from(creditGrant);
    expect(grants.length).toBe(interval === 'month' ? 1 : 12);
    expect(grants.every((grant) => grant.expiresAt > grant.issuedAt)).toBe(true);
    expect(grants.every((grant) => grant.expiresAt > new Date())).toBe(true);
  });
});

describe('refreshes and the billing cron', () => {
  test('the billing cron refuses a request without its secret', async () => {
    const response = await billingCron(new Request('http://localhost/api/cron/billing'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  test('a billing refresh never starts a new automatic purchase', async () => {
    network.list.mockResolvedValue({ data: [] });
    await reconcileCurrentSubscription(await billingWorkspace());
    await finishPendingAutoTopup(workspaceId);
    expect(await database.select().from(autoTopupAttempt)).toEqual([]);
    expect(network.createIntent).not.toHaveBeenCalled();
  });

  test('a subscription refresh keeps its grant when the top-up follow-up fails', async () => {
    await database.insert(autoTopupAttempt).values({
      workspaceId,
      credits: 1000,
      amountCents: 2000,
      status: 'pending',
      stripePaymentIntentId: 'pi_unavailable',
    });
    network.list.mockResolvedValue({
      data: [{ id: 'sub_recovery', status: 'active', latest_invoice: 'in_paid', created: 1 }],
    });
    network.invoice.mockResolvedValue({ ...(await paidInvoice()).data.object, status: 'paid' });
    network.retrieveIntent.mockRejectedValue(new Error('Stripe unavailable'));
    expect((await reconcileCurrentSubscription(await billingWorkspace())).kind).toBe('applied');
    expect(await database.select().from(creditGrant)).toHaveLength(1);
    expect((await database.select().from(autoTopupAttempt)).at(0)?.status).toBe('pending');
  });

  test('usage that cannot be loaded is closed oldest first and cannot fill every later recovery batch', async () => {
    await seedUser(database, 'recovery-user');
    const sessionId = randomUUID();
    await database.insert(session).values({
      workspaceMemoryAccess: 'read_write',
      id: sessionId,
      workspaceId,
      createdByUserId: 'recovery-user',
      tier: 'default',
      kind: 'chat',
    });
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      workspaceId,
      sessionId,
      usageKey: `usage-${index}`,
      eventType: 'tool_call' as const,
      creditsDelta: -1,
      settlementStatus: 'pending' as const,
      createdAt: new Date(1_700_000_000_000 + index * 1000),
    }));
    await database.insert(usageEvent).values(rows);
    const pending = () =>
      database.select().from(usageEvent).where(eq(usageEvent.settlementStatus, 'pending'));
    await runBillingRecovery();
    expect((await pending()).map((row) => row.usageKey)).toEqual(['usage-100']);
    await runBillingRecovery();
    expect(await pending()).toEqual([]);
    const first = rows.at(0);
    if (!first) throw new Error('Expected usage fixture');
    expect(await completeUnloadedUsageSettlement(first.id)).toBe(false);
  });
});
