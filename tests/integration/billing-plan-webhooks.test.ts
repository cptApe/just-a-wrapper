// Stripe plan webhooks on real Postgres: invoice.paid grants, mid-cycle changes, subscription ends and updates, reconciliation.
import { consumeWorkspaceCredits } from '@/features/billing/api/credit-ledger';
import { expiresAtMonthsAfter } from '@/features/billing/pricing-config';
import { creditBalanceProjection, seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';

const stripeNetwork = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  retrieveInvoice: vi.fn(),
  listSubscriptions: vi.fn(),
  retrieveIntent: vi.fn(),
  createRefund: vi.fn(),
  listInvoicePayments: vi.fn(),
}));
vi.mock('@/lib/stripe', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/stripe')>();
  const getStripe = () => {
    const client = original.getStripe();
    if (!client) throw new Error('Stripe test client is not configured');
    return {
      webhooks: client.webhooks,
      prices: client.prices,
      webhookEndpoints: {
        list: () => [
          {
            status: 'enabled',
            url: 'http://localhost:3000/api/webhooks/stripe',
            enabled_events: ['*'],
          },
        ],
      },
      subscriptions: {
        retrieve: stripeNetwork.retrieveSubscription,
        list: stripeNetwork.listSubscriptions,
      },
      checkout: { sessions: { retrieve: stripeNetwork.retrieveCheckoutSession } },
      invoices: { retrieve: stripeNetwork.retrieveInvoice },
      paymentIntents: { retrieve: stripeNetwork.retrieveIntent },
      refunds: { create: stripeNetwork.createRefund },
      invoicePayments: { list: stripeNetwork.listInvoicePayments },
    };
  };
  return { ...original, getStripe, requireStripe: getStripe };
});

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getStripeWebhookStatus } from '@/features/admin/environment/api/get-stripe-webhook-status';
import {
  type ActiveWorkspace,
  processStripeWebhook as processStripeWebhookCore,
  reconcileCheckoutSession,
  reconcileCurrentSubscription,
} from '@/features/billing';
import { STRIPE_API_VERSION } from '@/lib/stripe';
import { applyMigrations, seedOrganization, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const db = makeTestDb(pool);

// Must match vitest.config.ts `env.STRIPE_WEBHOOK_SECRET`, so the signature verifies.
const WEBHOOK_SECRET = 'whsec_test_secret_for_signature_tests';
const stripe = new Stripe('sk_test_dummy_for_offline_signature_tests', {
  apiVersion: STRIPE_API_VERSION,
});

const ORG = 'org_billing';
const CUSTOMER_ID = 'cus_test_billing';
const BLOCK_CREDITS = 100;
// A mid-cycle change grants against the money that cleared, so fixture invoices carry real amounts.
const BLOCK_PRICE_CENTS: Record<'month' | 'year', number> = { month: 500, year: 5_000 };

// Expanded package prices carry the whole grant in metadata and use quantity one.
function planPrice(tier: 'pro' | 'max', interval: 'month' | 'year', credits: number) {
  return {
    id: `price_plan_${tier}_${interval}_${credits}`,
    object: 'price',
    lookup_key: `plan_${tier}_${interval}_${credits}`,
    metadata: {
      kind: 'plan',
      tier,
      interval,
      credits: String(credits),
      block_credits: String(credits),
    },
    recurring: { interval },
  };
}

type InvoiceOptions = {
  eventId: string;
  credits: number;
  subscriptionId: string;
  customerId?: string;
  interval?: 'month' | 'year';
  created?: number;
  tier?: 'pro' | 'max';
  billingReason?: string;
  amountPaid?: number;
  period?: { start: number; end: number };
};

// An invoice.paid event shaped like the dahlia API. `billing_reason` tells a period payment from a
// mid-cycle change, and `amount_paid` is what a mid-cycle change grants against.
function buildInvoicePaidEvent(opts: InvoiceOptions): Record<string, unknown> {
  const interval = opts.interval ?? 'month';
  const amountPaid =
    opts.amountPaid ?? (opts.credits / BLOCK_CREDITS) * BLOCK_PRICE_CENTS[interval];
  return {
    id: opts.eventId,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: opts.created ?? 1_700_000_000,
    type: 'invoice.paid',
    livemode: false,
    data: {
      object: {
        id: `in_${opts.eventId}`,
        object: 'invoice',
        created: opts.created ?? 1_700_000_000,
        livemode: false,
        status: 'paid',
        customer: opts.customerId ?? CUSTOMER_ID,
        billing_reason: opts.billingReason ?? 'subscription_create',
        amount_paid: amountPaid,
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: opts.subscriptionId, metadata: {} },
        },
        lines: {
          object: 'list',
          data: [
            {
              period: opts.period ?? {
                start: Math.floor(Date.now() / 1000),
                end: Math.floor(
                  expiresAtMonthsAfter(new Date(), interval === 'year' ? 12 : 1).getTime() / 1000,
                ),
              },
              id: 'il_test_1',
              object: 'line_item',
              amount: amountPaid,
              quantity: 1,
              pricing: {
                type: 'price_details',
                price_details: {
                  price: planPrice(opts.tier ?? 'pro', interval, opts.credits),
                  product: 'prod_test',
                },
              },
            },
          ],
        },
      },
    },
  };
}

// A live customer.subscription.updated whose single item carries the package price.
function buildSubscriptionUpdatedEvent(opts: {
  eventId: string;
  subscriptionId: string;
  credits: number;
}): Record<string, unknown> {
  return {
    id: opts.eventId,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: 1_700_000_000,
    type: 'customer.subscription.updated',
    livemode: false,
    data: {
      object: {
        id: opts.subscriptionId,
        object: 'subscription',
        status: 'active',
        customer: CUSTOMER_ID,
        items: {
          object: 'list',
          data: [
            {
              id: 'si_test_1',
              object: 'subscription_item',
              quantity: 1,
              price: planPrice('pro', 'month', opts.credits),
            },
          ],
        },
      },
    },
  };
}

function subscriptionDeletedEvent(eventId: string, subscriptionId: string, created: number) {
  return {
    id: eventId,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created,
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: subscriptionId,
        object: 'subscription',
        status: 'canceled',
        customer: CUSTOMER_ID,
      },
    },
  };
}

async function signedDelivery(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, signature };
}

type TestSubscriptionState = Pick<Stripe.Subscription, 'latest_invoice' | 'status'> &
  Partial<Pick<Stripe.Subscription, 'id' | 'customer'>>;

// By default Stripe reports the delivered invoice as the subscription's latest one.
async function processStripeWebhook(
  payload: string,
  signature: string,
  subscriptionState?: TestSubscriptionState,
) {
  const event = JSON.parse(payload) as {
    type: string;
    data: { object: { id: string; status?: Stripe.Subscription.Status } };
  };
  const fallbackState: TestSubscriptionState =
    event.type === 'customer.subscription.deleted'
      ? { latest_invoice: null, status: event.data.object.status ?? 'canceled' }
      : { latest_invoice: event.data.object.id, status: 'active' };
  return withStripeReads(
    { retrieveSubscription: async () => subscriptionState ?? fallbackState },
    () => processStripeWebhookCore(payload, signature),
  );
}

async function deliver(event: Record<string, unknown>, subscriptionState?: TestSubscriptionState) {
  const { payload, signature } = await signedDelivery(event);
  return processStripeWebhook(payload, signature, subscriptionState);
}

function deliverInvoice(opts: InvoiceOptions, subscriptionState?: TestSubscriptionState) {
  return deliver(buildInvoicePaidEvent(opts), subscriptionState);
}

function withStripeReads<T>(
  reads: {
    retrieveSubscription?: (
      id: string,
    ) => Promise<Pick<Stripe.Subscription, 'latest_invoice' | 'status'>>;
    retrieveCheckoutSession?: (id: string) => Promise<Stripe.Checkout.Session>;
    retrieveInvoice?: (id: string) => Promise<Stripe.Invoice>;
    listSubscriptions?: (customerId: string) => Promise<Stripe.Subscription[]>;
  },
  run: () => Promise<T>,
): Promise<T> {
  if (reads.retrieveSubscription)
    stripeNetwork.retrieveSubscription.mockImplementation(reads.retrieveSubscription);
  if (reads.retrieveCheckoutSession)
    stripeNetwork.retrieveCheckoutSession.mockImplementation(reads.retrieveCheckoutSession);
  if (reads.retrieveInvoice)
    stripeNetwork.retrieveInvoice.mockImplementation(reads.retrieveInvoice);
  if (reads.listSubscriptions) {
    const list = reads.listSubscriptions;
    stripeNetwork.listSubscriptions.mockImplementation(
      async ({ customer }: { customer: string }) => ({ data: await list(customer) }),
    );
  }
  return run();
}

async function seedWorkspaceWithCustomer(initialBalance: number): Promise<string> {
  await seedOrganization(db, ORG);
  const id = randomUUID();
  await db.execute(
    sql`insert into workspace (id, organization_id, name, stripe_customer_id)
        values (${id}, ${ORG}, ${'Billing WS'}, ${CUSTOMER_ID})`,
  );
  await seedCreditBalance(db, id, initialBalance);
  return id;
}

async function balanceOf(workspaceId: string): Promise<number> {
  return (await planRow(workspaceId)).credit_balance;
}

async function planRow(workspaceId: string) {
  const { rows } = await db.execute<{
    plan_tier: string;
    plan_credits: number | null;
    plan_billing_interval: string | null;
    stripe_subscription_id: string | null;
    auto_topup_enabled: boolean;
    credit_balance: number;
  }>(
    sql`select plan_tier, plan_credits, plan_billing_interval, stripe_subscription_id,
               auto_topup_enabled, ${creditBalanceProjection}
        from workspace where id = ${workspaceId}`,
  );
  return requiredRow(rows.at(0));
}

async function planGrantCount(workspaceId: string, where = sql`true`): Promise<number> {
  const { rows } = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from credit_grant
        where workspace_id = ${workspaceId} and source = 'plan' and ${where}`,
  );
  return requiredRow(rows.at(0)).count;
}

async function activeDebtHolds(workspaceId: string): Promise<number> {
  const { rows } = await db.execute<{ active_holds: number }>(sql`
    select count(*) filter (where source_ref like 'debt:hold:%' and consumed > amount)::int as active_holds
    from credit_grant where workspace_id = ${workspaceId}
  `);
  return requiredRow(rows.at(0)).active_holds;
}

function activeWorkspace(workspaceId: string): ActiveWorkspace {
  return {
    id: workspaceId,
    organizationId: ORG,
    name: 'Billing WS',
    creditBalance: 0,
    creditResetAt: null,
    stripeCustomerId: CUSTOMER_ID,
    stripeSubscriptionId: null,
    planTier: 'none',
    planBillingInterval: null,
    planCredits: null,
    autoTopupEnabled: false,
    autoTopupThresholdCredits: 20,
    autoTopupCredits: 400,
    autoTopupMonthlyCapCents: 25_000,
    userEmail: 'owner@example.test',
    userId: 'user_owner',
  };
}

beforeAll(async () => {
  await applyMigrations(db);
});

beforeEach(async () => {
  for (const read of Object.values(stripeNetwork)) read.mockReset();
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('invoice.paid grants a plan once', () => {
  test('a first payment adds the package to existing credits and records the plan and subscription', async () => {
    const wsId = await seedWorkspaceWithCustomer(999);
    const result = await deliverInvoice({
      eventId: 'evt_first_payment',
      credits: 2_000,
      tier: 'max',
      subscriptionId: 'sub_first_payment',
    });

    expect(result).toMatchObject({
      status: 200,
      body: { received: true, credits: 2_000, workspaceId: wsId },
    });
    expect(await planRow(wsId)).toMatchObject({
      plan_tier: 'max',
      plan_credits: 2_000,
      plan_billing_interval: 'month',
      stripe_subscription_id: 'sub_first_payment',
      credit_balance: 2_999,
    });
  });

  test('a redelivered invoice does not grant again after the credits were spent', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const event = buildInvoicePaidEvent({
      eventId: 'evt_invoice_paid_replay',
      credits: 800,
      subscriptionId: 'sub_test_2',
    });

    expect((await deliver(event)).body).toMatchObject({ credits: 800 });
    // Spend between deliveries so a wrong second grant would show.
    await db.transaction((tx) => consumeWorkspaceCredits(tx, { workspaceId: wsId, credits: 677 }));

    const replay = await deliver(event);
    expect(replay).toMatchObject({ status: 200, body: { idempotent: true } });
    expect(await balanceOf(wsId)).toBe(123);
    // One payload-free receipt per event.
    const { rows } = await db.execute<{ event_id: string; payload: unknown }>(
      sql`select event_id, payload from processed_webhook_event where provider = 'stripe'`,
    );
    expect(rows).toEqual([{ event_id: 'evt_invoice_paid_replay', payload: null }]);
  });

  test('two concurrent deliveries of one invoice grant it once', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const { payload, signature } = await signedDelivery(
      buildInvoicePaidEvent({
        eventId: 'evt_invoice_paid_race',
        credits: 800,
        subscriptionId: 'sub_test_race',
      }),
    );
    const results = await Promise.allSettled([
      processStripeWebhook(payload, signature),
      processStripeWebhook(payload, signature),
    ]);
    // The loser waits on the workspace lock, then finds the grant or a moved revision.
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(await balanceOf(wsId)).toBe(800);
    expect(await planGrantCount(wsId)).toBe(1);
  });

  test('a renewal grants the whole package again even after the month was spent', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_cycle_first',
      credits: 400,
      subscriptionId: 'sub_cycle',
      created: 1_700_000_100,
    });
    await db.execute(
      sql`update credit_grant set consumed = 300 where workspace_id = ${wsId} and source = 'plan'`,
    );

    const result = await deliverInvoice({
      eventId: 'evt_cycle_renewal',
      credits: 400,
      subscriptionId: 'sub_cycle',
      billingReason: 'subscription_cycle',
      created: 1_700_000_200,
    });

    expect(result.body).toMatchObject({ credits: 400 });
    expect(await planGrantCount(wsId, sql`amount = 400`)).toBe(2);
  });

  test('a yearly plan schedules twelve monthly grants and only this month is spendable', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_invoice_paid_yearly',
      credits: 200,
      subscriptionId: 'sub_test_yearly',
      interval: 'year',
    });

    expect(await balanceOf(wsId)).toBe(200);
    expect(await planGrantCount(wsId)).toBe(12);
    expect(await planGrantCount(wsId, sql`issued_at > now()`)).toBe(11);
  });

  test('a cycle grant expires at the invoiced period end plus the renewal grace day', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const start = Math.floor(Date.now() / 1000) - 86400;
    const end = start + 40 * 86400;
    await deliverInvoice({
      eventId: 'evt_grace',
      credits: 1000,
      subscriptionId: 'sub_grace',
      period: { start, end },
    });
    const { rows } = await db.execute<{ expires_at: Date }>(
      sql`select expires_at from credit_grant where workspace_id = ${wsId} and source = 'plan'`,
    );
    expect(new Date(requiredRow(rows.at(0)).expires_at).getTime()).toBe((end + 86400) * 1000);
  });

  test('an invoice whose price carries no plan metadata grants nothing instead of guessing', async () => {
    await seedWorkspaceWithCustomer(0);
    const event = buildInvoicePaidEvent({
      eventId: 'evt_no_metadata',
      credits: 400,
      subscriptionId: 'sub_no_metadata',
    }) as {
      data: {
        object: {
          lines: { data: { pricing: { price_details: { price: { metadata: unknown } } } }[] };
        };
      };
    };
    requiredRow(event.data.object.lines.data.at(0)).pricing.price_details.price.metadata = {};

    await expect(deliver(event as Record<string, unknown>)).resolves.toMatchObject({
      body: { ignored: 'not-plan-invoice' },
    });
  });

  test('a plan line with no quantity is refused rather than counted as one block', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const event = buildInvoicePaidEvent({
      eventId: 'evt_no_quantity',
      credits: 20_000,
      subscriptionId: 'sub_no_quantity',
    }) as unknown as { data: { object: { lines: { data: { quantity?: number }[] } } } };
    // Reading a missing quantity as one block would grant 100 credits against a $1,000 plan.
    delete requiredRow(event.data.object.lines.data.at(0)).quantity;

    await expect(deliver(event as unknown as Record<string, unknown>)).rejects.toThrow(
      /no usable quantity/,
    );
    expect(await balanceOf(wsId)).toBe(0);
    expect(await planGrantCount(wsId)).toBe(0);
  });

  test('a payload with a forged signature is rejected and grants nothing', async () => {
    const wsId = await seedWorkspaceWithCustomer(50);
    const { payload } = await signedDelivery(
      buildInvoicePaidEvent({ eventId: 'evt_bad_sig', credits: 400, subscriptionId: 'sub_x' }),
    );

    await expect(processStripeWebhook(payload, 't=1,v1=deadbeef')).rejects.toThrow(
      /signature verification failed/,
    );
    expect(await balanceOf(wsId)).toBe(50);
  });

  test('an event type the app does not handle is acknowledged so Stripe stops retrying', async () => {
    const result = await deliver({
      id: 'evt_unhandled',
      object: 'event',
      api_version: STRIPE_API_VERSION,
      type: 'customer.updated',
      data: { object: { id: 'cus_x', object: 'customer' } },
    });
    expect(result).toMatchObject({ status: 200, body: { ignored: 'customer.updated' } });
  });
});

describe('payments from a customer with no workspace', () => {
  test('a paid invoice is refunded and acknowledged, not retried', async () => {
    await seedOrganization(db, ORG);
    stripeNetwork.listInvoicePayments.mockImplementation(async function* () {
      yield { id: 'inpay_orphan', payment: { payment_intent: 'pi_orphan_invoice' } };
    });
    stripeNetwork.retrieveIntent.mockResolvedValue({
      id: 'pi_orphan_invoice',
      latest_charge: null,
    });
    stripeNetwork.createRefund.mockResolvedValue({ id: 're_orphan' });

    const result = await deliverInvoice({
      eventId: 'evt_invoice_orphan',
      customerId: 'cus_without_workspace',
      credits: 400,
      subscriptionId: 'sub_orphan',
    });
    expect(result).toMatchObject({ status: 200, body: { ignored: 'no-workspace' } });
    expect(stripeNetwork.createRefund).toHaveBeenCalledWith(
      { payment_intent: 'pi_orphan_invoice' },
      { idempotencyKey: 'refund-deleted-workspace:pi_orphan_invoice' },
    );
  });

  test('a top-up is refunded and acknowledged, not retried', async () => {
    stripeNetwork.retrieveIntent.mockResolvedValue({ id: 'pi_orphan_topup', latest_charge: null });
    stripeNetwork.createRefund.mockResolvedValue({ id: 're_orphan_topup' });
    const result = await deliver({
      id: 'evt_topup_orphan',
      object: 'event',
      api_version: STRIPE_API_VERSION,
      created: 1_700_000_000,
      type: 'payment_intent.succeeded',
      livemode: false,
      data: {
        object: {
          id: 'pi_orphan_topup',
          object: 'payment_intent',
          status: 'succeeded',
          customer: 'cus_without_workspace',
          metadata: { kind: 'topup', credits: '500' },
        },
      },
    });
    expect(result).toMatchObject({
      status: 200,
      body: { applied: false, ignored: 'no-workspace' },
    });
    expect(stripeNetwork.createRefund).toHaveBeenCalledWith(
      { payment_intent: 'pi_orphan_topup' },
      { idempotencyKey: 'refund-deleted-workspace:pi_orphan_topup' },
    );
  });
});

describe('reconciliation and the webhook grant once between them', () => {
  test('a top-up Checkout reconciled twice grants its credits once', async () => {
    const workspaceId = await seedWorkspaceWithCustomer(0);
    const checkout = {
      id: 'cs_return_topup',
      object: 'checkout.session',
      created: 1700000000,
      livemode: false,
      mode: 'payment',
      payment_status: 'paid',
      customer: CUSTOMER_ID,
      payment_intent: 'pi_return_topup',
      metadata: { kind: 'topup', credits: '500' },
    } as unknown as Stripe.Checkout.Session;
    const reconcile = () =>
      withStripeReads({ retrieveCheckoutSession: async () => checkout }, () =>
        reconcileCheckoutSession({
          workspace: activeWorkspace(workspaceId),
          checkoutSessionId: checkout.id,
        }),
      );
    expect((await reconcile()).kind).toBe('applied');
    expect((await reconcile()).kind).toBe('unchanged');
    expect(await balanceOf(workspaceId)).toBe(500);
  });

  test('a plan applied on the Checkout return is not granted again by the following webhook', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const event = buildInvoicePaidEvent({
      eventId: 'evt_after_checkout_return',
      credits: 400,
      subscriptionId: 'sub_checkout_return',
    });
    const invoice = (event.data as { object: Stripe.Invoice }).object;
    const subscription = {
      id: 'sub_checkout_return',
      object: 'subscription',
      created: 1_700_000_000,
      livemode: false,
      status: 'active',
      latest_invoice: invoice.id,
    } as Stripe.Subscription;
    const checkout = {
      id: 'cs_checkout_return',
      object: 'checkout.session',
      created: 1_700_000_000,
      livemode: false,
      mode: 'subscription',
      customer: CUSTOMER_ID,
      subscription: subscription.id,
      payment_status: 'paid',
    } as Stripe.Checkout.Session;

    const reconciled = await withStripeReads(
      {
        retrieveCheckoutSession: async () => checkout,
        retrieveSubscription: async () => subscription,
        retrieveInvoice: async () => invoice,
      },
      () =>
        reconcileCheckoutSession({
          checkoutSessionId: checkout.id,
          workspace: activeWorkspace(wsId),
        }),
    );

    expect(reconciled.kind).toBe('applied');
    expect(await balanceOf(wsId)).toBe(400);
    // The admin webhook status still says no webhook has arrived.
    expect(await getStripeWebhookStatus()).toEqual({ kind: 'never', configurationErrors: [] });
    const webhook = await deliver(event, subscription);
    expect(webhook.body).toMatchObject({ received: true, idempotent: true });
    expect(await balanceOf(wsId)).toBe(400);
    expect(await getStripeWebhookStatus()).toMatchObject({ kind: 'received' });
  });

  test('a subscription refresh after the webhook does not grant the invoice again', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const event = buildInvoicePaidEvent({
      eventId: 'evt_before_subscription_refresh',
      credits: 400,
      subscriptionId: 'sub_subscription_refresh',
    });
    const invoice = (event.data as { object: Stripe.Invoice }).object;
    const subscription = {
      id: 'sub_subscription_refresh',
      object: 'subscription',
      created: 1_700_000_000,
      livemode: false,
      status: 'active',
      latest_invoice: invoice.id,
    } as Stripe.Subscription;

    await deliver(event, subscription);
    const reconciled = await withStripeReads(
      { listSubscriptions: async () => [subscription], retrieveInvoice: async () => invoice },
      () => reconcileCurrentSubscription(activeWorkspace(wsId)),
    );

    expect(reconciled.kind).toBe('unchanged');
    expect(await balanceOf(wsId)).toBe(400);
    expect(await planGrantCount(wsId)).toBe(1);
  });
});

describe('mid-cycle plan changes grant what was paid', () => {
  test('moving up on day one grants the difference paid for, not a second package', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_delta_first',
      credits: 400,
      subscriptionId: 'sub_delta',
      created: 1_700_000_100,
    });

    // The whole period is ahead, so Stripe collects the full difference: 8 blocks at $1.
    const result = await deliverInvoice({
      eventId: 'evt_delta_upgrade',
      credits: 1_200,
      subscriptionId: 'sub_delta',
      billingReason: 'subscription_update',
      amountPaid: 800,
      created: 1_700_000_200,
    });

    expect(result.body).toMatchObject({ credits: 800 });
    expect(await planRow(wsId)).toMatchObject({ plan_credits: 1_200, credit_balance: 1_200 });
  });

  test('an upgrade on the last day of the cycle grants only the day paid for, then the renewal grants the package once', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_late_upgrade_first',
      credits: 400,
      subscriptionId: 'sub_late_upgrade',
      created: 1_700_000_100,
    });

    // Day 29 of 30: Pro 400 becomes Pro 20,000 and Stripe prorates to $13.07.
    const upgradeEvent = buildInvoicePaidEvent({
      eventId: 'evt_late_upgrade',
      credits: 20_000,
      subscriptionId: 'sub_late_upgrade',
      billingReason: 'subscription_update',
      amountPaid: 1_307,
      created: 1_700_000_200,
    }) as unknown as { data: { object: { lines: { data: Record<string, unknown>[] } } } };
    // A real proration invoice credits the old package first, so the plan is read off the line with money on it.
    upgradeEvent.data.object.lines.data.unshift({
      id: 'il_unused_old_package',
      object: 'line_item',
      amount: -67,
      quantity: 1,
      pricing: {
        type: 'price_details',
        price_details: { price: planPrice('pro', 'month', 400), product: 'prod_test' },
      },
    });
    const result = await deliver(upgradeEvent as unknown as Record<string, unknown>);

    // The package difference would have been 19,600 credits for one day of money.
    expect(result.body).toMatchObject({ credits: 1_307 });
    expect(await planRow(wsId)).toMatchObject({ plan_credits: 20_000, credit_balance: 1_707 });

    const renewed = await deliverInvoice({
      eventId: 'evt_late_upgrade_renewal',
      credits: 20_000,
      subscriptionId: 'sub_late_upgrade',
      billingReason: 'subscription_cycle',
      created: 1_700_000_300,
    });
    expect(renewed.body).toMatchObject({ credits: 20_000 });
    expect(await planGrantCount(wsId, sql`amount = 20000`)).toBe(1);
  });

  test('moving down mid-cycle grants nothing and keeps the credits already paid for', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_shrink_first',
      credits: 1_200,
      subscriptionId: 'sub_shrink',
      created: 1_700_000_100,
    });

    const result = await deliverInvoice({
      eventId: 'evt_shrink_down',
      credits: 400,
      subscriptionId: 'sub_shrink',
      billingReason: 'subscription_update',
      amountPaid: 0,
      created: 1_700_000_200,
    });

    expect(result.body).toMatchObject({ credits: 0 });
    expect(await planRow(wsId)).toMatchObject({ plan_credits: 400, credit_balance: 1_200 });
  });

  test('moving up on a yearly plan adds a separate share to every remaining month', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_yearly_delta_first',
      credits: 400,
      subscriptionId: 'sub_yearly_delta',
      interval: 'year',
      created: 1_700_000_100,
    });

    // The whole year is ahead: 4 more blocks at the yearly block price of $10.
    await deliverInvoice({
      eventId: 'evt_yearly_delta_up',
      credits: 800,
      subscriptionId: 'sub_yearly_delta',
      interval: 'year',
      billingReason: 'subscription_update',
      amountPaid: 4_000,
      created: 1_700_000_200,
    });

    expect(await balanceOf(wsId)).toBe(800);
    const { rows } = await db.execute<{ future_count: number; future_amounts: number[] }>(sql`
      select count(*) filter (where issued_at > now() and status = 'issued' and consumed < amount)::int as future_count,
             array_agg(distinct amount) filter (where issued_at > now() and status = 'issued' and consumed < amount) as future_amounts
      from credit_grant where workspace_id = ${wsId} and source = 'plan'
    `);
    expect(requiredRow(rows.at(0))).toEqual({ future_count: 22, future_amounts: [400] });
  });

  test('switching to yearly lays down a fresh twelve-month schedule, not a zero difference', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_interval_monthly',
      credits: 400,
      subscriptionId: 'sub_interval',
      created: 1_700_000_100,
    });

    // Stripe re-anchors on an interval change, so this update starts a new period.
    const result = await deliverInvoice({
      eventId: 'evt_interval_yearly',
      credits: 400,
      subscriptionId: 'sub_interval',
      interval: 'year',
      billingReason: 'subscription_update',
      created: 1_700_000_200,
    });

    expect(result.body).toMatchObject({ credits: 400 });
    const yearly = sql`source_ref like 'plan-invoice:in_evt_interval_yearly:%'`;
    expect(await planGrantCount(wsId, yearly)).toBe(12);
    expect(
      await planGrantCount(
        wsId,
        sql`${yearly} and issued_at > now() and status = 'issued' and consumed < amount`,
      ),
    ).toBe(11);
    expect(await planRow(wsId)).toMatchObject({ plan_billing_interval: 'year', plan_credits: 400 });
  });

  test('a yearly-to-monthly change retires the unissued months without touching spendable credits', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_invoice_paid_old_yearly',
      credits: 200,
      subscriptionId: 'sub_plan_change',
      interval: 'year',
      created: 1_700_000_100,
    });
    await deliverInvoice({
      eventId: 'evt_invoice_paid_plan_change',
      credits: 400,
      subscriptionId: 'sub_plan_change',
      created: 1_700_000_300,
    });

    expect(await balanceOf(wsId)).toBe(600);
    expect(
      await planGrantCount(
        wsId,
        sql`source_ref like 'plan-invoice:in_evt_invoice_paid_old_yearly:%' and issued_at > now() and status = 'retired'`,
      ),
    ).toBe(11);
    expect(
      await planGrantCount(
        wsId,
        sql`issued_at > now() and status = 'issued' and consumed < amount`,
      ),
    ).toBe(0);
  });

  test('a plan change puts back debt that retired future months had provisionally repaid', async () => {
    const wsId = await seedWorkspaceWithCustomer(-300);
    await deliverInvoice({
      eventId: 'evt_debt_old_yearly',
      credits: 100,
      subscriptionId: 'sub_debt_plan_change',
      interval: 'year',
      created: 1_700_000_100,
    });
    expect(await balanceOf(wsId)).toBe(-200);

    await deliverInvoice({
      eventId: 'evt_debt_new_monthly',
      credits: 100,
      subscriptionId: 'sub_debt_plan_change',
      created: 1_700_000_300,
    });

    expect(await balanceOf(wsId)).toBe(-100);
    expect(await activeDebtHolds(wsId)).toBe(0);
  });

  test('an older invoice delivered late grants its money but cannot replace the current plan', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_invoice_newer_plan',
      credits: 400,
      subscriptionId: 'sub_out_of_order',
      created: 1_700_000_300,
    });

    const stale = await deliverInvoice(
      {
        eventId: 'evt_invoice_older_plan',
        credits: 200,
        subscriptionId: 'sub_out_of_order',
        interval: 'year',
        created: 1_700_000_300,
      },
      { latest_invoice: 'in_evt_invoice_newer_plan', status: 'active' },
    );

    expect(stale.body).toMatchObject({ credits: 200 });
    expect(await planRow(wsId)).toMatchObject({
      plan_tier: 'pro',
      plan_billing_interval: 'month',
      credit_balance: 600,
    });
    expect(
      await planGrantCount(wsId, sql`source_ref like 'plan-invoice:in_evt_invoice_older_plan:%'`),
    ).toBe(12);
  });

  test('two same-second plan invoices are serialized so the stale one cannot overwrite the plan', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const older = await signedDelivery(
      buildInvoicePaidEvent({
        eventId: 'evt_concurrent_old_plan',
        credits: 200,
        subscriptionId: 'sub_concurrent_plan',
        interval: 'year',
        created: 1_700_000_600,
      }),
    );
    const newer = await signedDelivery(
      buildInvoicePaidEvent({
        eventId: 'evt_concurrent_new_plan',
        credits: 400,
        subscriptionId: 'sub_concurrent_plan',
        created: 1_700_000_600,
      }),
    );

    let releaseOlder!: (state: TestSubscriptionState) => void;
    const olderState = new Promise<TestSubscriptionState>((resolve) => {
      releaseOlder = resolve;
    });
    let olderRetrieveStarted!: () => void;
    const olderRetrieving = new Promise<void>((resolve) => {
      olderRetrieveStarted = resolve;
    });
    let newerRetrieveStarted = false;

    // The older delivery holds its Stripe read open while the newer one commits.
    const olderDelivery = withStripeReads(
      {
        retrieveSubscription: async () => {
          olderRetrieveStarted();
          return olderState;
        },
      },
      () => processStripeWebhookCore(older.payload, older.signature),
    );
    await olderRetrieving;

    const newerDelivery = withStripeReads(
      {
        retrieveSubscription: async () => {
          newerRetrieveStarted = true;
          return { latest_invoice: 'in_evt_concurrent_new_plan', status: 'active' };
        },
      },
      () => processStripeWebhookCore(newer.payload, newer.signature),
    );
    const olderRefused = expect(olderDelivery).rejects.toMatchObject({ code: 'CONFLICT' });
    await newerDelivery;
    expect(newerRetrieveStarted).toBe(true);
    releaseOlder({ latest_invoice: 'in_evt_concurrent_old_plan', status: 'active' });
    await olderRefused;
    // Stripe's retry of the older invoice then reads the newer plan as current.
    await processStripeWebhook(older.payload, older.signature, {
      latest_invoice: 'in_evt_concurrent_new_plan',
      status: 'active',
    });

    expect(await planRow(wsId)).toMatchObject({
      plan_tier: 'pro',
      plan_billing_interval: 'month',
      credit_balance: 600,
    });
  });
});

describe('the end of a subscription', () => {
  test('a cancellation in the same second as the invoice still ends the plan', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_same_second_invoice',
      credits: 400,
      subscriptionId: 'sub_same_second',
      created: 1_700_000_500,
    });

    await deliver(
      subscriptionDeletedEvent('evt_same_second_deleted', 'sub_same_second', 1_700_000_500),
      { latest_invoice: 'in_evt_same_second_invoice', status: 'canceled' },
    );

    expect(await planRow(wsId)).toMatchObject({ plan_tier: 'none', credit_balance: 0 });
  });

  test('ending a yearly plan puts back debt that its unissued months had provisionally repaid', async () => {
    const wsId = await seedWorkspaceWithCustomer(-300);
    await deliverInvoice({
      eventId: 'evt_debt_before_cancel',
      credits: 100,
      subscriptionId: 'sub_debt_cancel',
      interval: 'year',
      created: 1_700_000_400,
    });
    expect(await balanceOf(wsId)).toBe(-200);

    await deliver(
      subscriptionDeletedEvent('evt_debt_cancelled', 'sub_debt_cancel', 1_700_000_500),
      {
        latest_invoice: 'in_evt_debt_before_cancel',
        status: 'canceled',
      },
    );

    expect(await balanceOf(wsId)).toBe(-200);
    expect(await activeDebtHolds(wsId)).toBe(0);
  });
});

describe('customer.subscription.updated', () => {
  test('a delayed update for a cancelled subscription cannot disturb its replacement', async () => {
    const workspaceId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_replacement',
      subscriptionId: 'sub_replacement',
      credits: 1000,
    });
    const result = await deliver(
      buildSubscriptionUpdatedEvent({
        eventId: 'evt_previous',
        subscriptionId: 'sub_previous',
        credits: 400,
      }),
      { id: 'sub_previous', customer: CUSTOMER_ID, status: 'canceled', latest_invoice: null },
    );
    expect(result.body).toMatchObject({ received: true, unmapped: true });
    expect(await planRow(workspaceId)).toMatchObject({
      stripe_subscription_id: 'sub_replacement',
      credit_balance: 1000,
    });
  });

  test('a redelivered update that already granted its invoice can still end the plan', async () => {
    const workspaceId = await seedWorkspaceWithCustomer(0);
    const invoice = (
      buildInvoicePaidEvent({
        eventId: 'evt_unused_invoice_envelope',
        credits: 1000,
        subscriptionId: 'sub_redelivered',
      }).data as { object: Stripe.Invoice }
    ).object;
    const delivery = await signedDelivery(
      buildSubscriptionUpdatedEvent({
        eventId: 'evt_update_redelivered',
        subscriptionId: 'sub_redelivered',
        credits: 1000,
      }),
    );
    const active = { id: 'sub_redelivered', customer: CUSTOMER_ID, status: 'active' as const };
    await withStripeReads(
      {
        retrieveSubscription: async () => ({ ...active, latest_invoice: invoice.id }),
        retrieveInvoice: async () => invoice,
      },
      () => processStripeWebhookCore(delivery.payload, delivery.signature),
    );
    expect(await balanceOf(workspaceId)).toBe(1000);

    const ended = await withStripeReads(
      {
        retrieveSubscription: async () => ({ ...active, status: 'canceled', latest_invoice: null }),
      },
      () => processStripeWebhookCore(delivery.payload, delivery.signature),
    );
    expect(ended.body).toMatchObject({ received: true, idempotent: false, workspaceId });
    expect(await planRow(workspaceId)).toMatchObject({
      stripe_subscription_id: null,
      plan_tier: 'none',
    });
  });

  test('an update with no paid invoice grants nothing and keeps the purchased package', async () => {
    const workspaceId = await seedWorkspaceWithCustomer(0);
    await deliverInvoice({
      eventId: 'evt_paid',
      subscriptionId: 'sub_paid',
      credits: 2000,
      tier: 'max',
    });
    const result = await deliver(
      buildSubscriptionUpdatedEvent({
        eventId: 'evt_down',
        subscriptionId: 'sub_paid',
        credits: 1000,
      }),
      { id: 'sub_paid', customer: CUSTOMER_ID, status: 'active', latest_invoice: null },
    );
    expect(result.body).toMatchObject({ kind: 'deferred' });
    expect(await planRow(workspaceId)).toMatchObject({
      plan_tier: 'max',
      plan_credits: 2000,
      credit_balance: 2000,
    });
  });
});
