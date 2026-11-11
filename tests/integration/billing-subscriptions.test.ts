// Subscriptions through the app's plan actions on real Postgres: Checkout, upgrades, downgrades, cancel, failed payments; Stripe is a fake account.

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; args: unknown[] }>,
  subscription: null as Record<string, unknown> | null,
  schedule: null as Record<string, unknown> | null,
  invoices: new Map<string, Record<string, unknown>>(),
  previewCents: 500,
  updateFailure: null as unknown,
}));

vi.mock('@/lib/stripe', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/stripe')>();
  const real = original.getStripe();
  if (!real) throw new Error('Stripe test client is not configured');
  const { buildIntendedCatalog } = await import('@/features/billing/lib/stripe-plan');
  const prices = buildIntendedCatalog().map((price) => ({
    id: `price_${price.lookupKey}`,
    object: 'price',
    active: true,
    currency: 'usd',
    product: price.productId,
    lookup_key: price.lookupKey,
    unit_amount: price.unitAmountCents,
    recurring: { interval: price.interval },
    metadata: price.metadata,
  }));
  const record = (op: string, ...args: unknown[]) => fake.calls.push({ op, args });
  const priceById = (id: string) => prices.find((price) => price.id === id);
  const client = {
    webhooks: real.webhooks,
    prices: {
      list: (params: { product?: string }) =>
        prices.filter((price) => !params.product || price.product === params.product),
      retrieve: async (id: string) => priceById(id),
    },
    customers: { create: async () => ({ id: 'cus_created' }) },
    checkout: {
      sessions: {
        list: () => [],
        expire: async (id: string) => record('checkout.expire', id),
        create: async (params: unknown, options: unknown) => {
          record('checkout.create', params, options);
          return { id: 'cs_plan', url: 'https://checkout.stripe.test/cs_plan' };
        },
      },
    },
    subscriptions: {
      list: () => [],
      cancel: async (id: string) => record('subscriptions.cancel', id),
      retrieve: async () => fake.subscription,
      update: async (id: string, params: Record<string, unknown>, options?: unknown) => {
        record('subscriptions.update', id, params, options);
        if (fake.updateFailure) throw fake.updateFailure;
        const subscription = fake.subscription ?? {};
        if ('cancel_at_period_end' in params)
          subscription.cancel_at_period_end = params.cancel_at_period_end;
        return { ...subscription, cancel_at: null };
      },
    },
    subscriptionSchedules: {
      create: async (params: unknown) => {
        record('schedules.create', params);
        fake.schedule = { id: 'sub_sched', status: 'active', end_behavior: 'release', phases: [] };
        if (fake.subscription) fake.subscription.schedule = 'sub_sched';
        return fake.schedule;
      },
      retrieve: async () => fake.schedule,
      update: async (id: string, params: { phases: Array<Record<string, unknown>> }) => {
        record('schedules.update', id, params);
        if (!fake.schedule) throw new Error('no schedule');
        // Stripe returns phases with expanded prices when asked; this fake always does.
        fake.schedule.phases = params.phases.map((phase) => ({
          ...phase,
          start_date: phase.start_date,
          items: (phase.items as Array<{ price: string }>).map((item) => ({
            ...item,
            price: priceById(item.price),
          })),
        }));
        return fake.schedule;
      },
      release: async (id: string) => {
        record('schedules.release', id);
        if (fake.schedule) fake.schedule.status = 'released';
        if (fake.subscription) fake.subscription.schedule = null;
      },
    },
    invoices: {
      createPreview: async (params: unknown) => {
        record('invoices.preview', params);
        return { amount_due: fake.previewCents, currency: 'usd' };
      },
      retrieve: async (id: string) => fake.invoices.get(id),
    },
  };
  return { ...original, getStripe: () => client, requireStripe: () => client };
});

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type ActiveWorkspace,
  cancelPlan,
  changePlan,
  createPlanCheckoutSession,
  getPlanOptions,
  previewPlanChange,
  processStripeWebhook,
} from '@/features/billing';
import { assertCanStartChat } from '@/features/billing/api/assert-plan-limits';
import { getCurrentPlanCreditsExpireAt } from '@/features/billing/api/credit-ledger';
import { getTopupOptions } from '@/features/billing/api/get-topup-options';
import { writeDeploymentSetting } from '@/lib/deployment-settings/store';
import { STRIPE_API_VERSION } from '@/lib/stripe';
import { creditBalanceProjection, seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const db = makeTestDb(pool);
const signer = new Stripe('sk_test_dummy_for_offline_signature_tests', {
  apiVersion: STRIPE_API_VERSION,
});
const WEBHOOK_SECRET = 'whsec_test_secret_for_signature_tests';
const ORG = 'org_plans';
const CUSTOMER = 'cus_plans';
const SUBSCRIPTION = 'sub_plans';
const DAY = 24 * 60 * 60;

const pro1000 = { tier: 'pro', interval: 'month', credits: 1000 } as const;
const pro2000 = { tier: 'pro', interval: 'month', credits: 2000 } as const;

beforeAll(async () => {
  await applyMigrations(db);
});

beforeEach(async () => {
  fake.calls.length = 0;
  fake.subscription = null;
  fake.schedule = null;
  fake.invoices.clear();
  fake.previewCents = 500;
  fake.updateFailure = null;
  await truncateAll(db);
  await seedUser(db, 'owner', 'owner@plans.test');
  await seedOrganization(db, ORG);
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('plans-owner', ${ORG}, 'owner', 'owner', now())`,
  );
  await db.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id) values (${ORG}, 'owner', 'plans-owner')`,
  );
  // An admin switches this deployment to subscriptions; env says credits only.
  await writeDeploymentSetting({
    key: 'billingMode',
    value: 'subscriptions',
    actorUserId: 'owner',
  });
});

afterAll(async () => {
  await pool.end();
});

async function seedWorkspace(): Promise<string> {
  const id = randomUUID();
  await db.execute(
    sql`insert into workspace (id, organization_id, name, stripe_customer_id) values (${id}, ${ORG}, 'Plans', ${CUSTOMER})`,
  );
  return id;
}

async function activeWorkspace(id: string): Promise<ActiveWorkspace> {
  const { rows } = await db.execute<{
    stripe_subscription_id: string | null;
    plan_tier: 'none' | 'pro' | 'max';
    plan_billing_interval: 'month' | 'year' | null;
    plan_credits: number | null;
  }>(
    sql`select stripe_subscription_id, plan_tier, plan_billing_interval, plan_credits from workspace where id = ${id}`,
  );
  const row = requiredRow(rows.at(0));
  return {
    id,
    organizationId: ORG,
    name: 'Plans',
    creditBalance: 0,
    creditResetAt: null,
    stripeCustomerId: CUSTOMER,
    stripeSubscriptionId: row.stripe_subscription_id,
    planTier: row.plan_tier,
    planBillingInterval: row.plan_billing_interval,
    planCredits: row.plan_credits,
    autoTopupEnabled: false,
    autoTopupThresholdCredits: 20,
    autoTopupCredits: 1000,
    autoTopupMonthlyCapCents: 25_000,
    userEmail: 'owner@plans.test',
    userId: 'owner',
  };
}

function priceOf(choice: { tier: string; interval: string; credits: number }) {
  return {
    id: `price_plan_${choice.tier}_${choice.interval}_${choice.credits}`,
    object: 'price',
    currency: 'usd',
    unit_amount: choice.credits,
    recurring: { interval: choice.interval },
    metadata: {
      kind: 'plan',
      tier: choice.tier,
      interval: choice.interval,
      credits: String(choice.credits),
      block_credits: String(choice.credits),
    },
  };
}

function period() {
  const start = Math.floor(Date.now() / 1000);
  return { start, end: start + 30 * DAY };
}

// The subscription Stripe holds after a payment; the webhook handlers read it back.
function holdSubscription(
  choice: typeof pro1000 | typeof pro2000,
  latestInvoice: string,
): Record<string, unknown> {
  const { start, end } = period();
  const subscription = {
    id: SUBSCRIPTION,
    object: 'subscription',
    status: 'active',
    customer: CUSTOMER,
    cancel_at: null,
    cancel_at_period_end: false,
    schedule: fake.schedule && fake.schedule.status === 'active' ? 'sub_sched' : null,
    latest_invoice: latestInvoice,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_plans',
          object: 'subscription_item',
          quantity: 1,
          current_period_start: start,
          current_period_end: end,
          price: priceOf(choice),
        },
      ],
    },
  };
  fake.subscription = subscription;
  return subscription;
}

function paidInvoice(input: {
  id: string;
  choice: { tier: string; interval: string; credits: number };
  reason: 'subscription_create' | 'subscription_update' | 'subscription_cycle';
  amountPaid: number;
}) {
  const invoice = {
    id: input.id,
    object: 'invoice',
    status: 'paid',
    customer: CUSTOMER,
    billing_reason: input.reason,
    amount_paid: input.amountPaid,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: SUBSCRIPTION, metadata: {} },
    },
    lines: {
      object: 'list',
      has_more: false,
      data: [
        {
          id: `il_${input.id}`,
          object: 'line_item',
          amount: input.amountPaid,
          quantity: 1,
          period: period(),
          pricing: { type: 'price_details', price_details: { price: priceOf(input.choice) } },
        },
      ],
    },
  };
  fake.invoices.set(input.id, invoice);
  return invoice;
}

async function deliver(type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    type,
    livemode: false,
    data: { object },
  });
  const signature = await signer.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return processStripeWebhook(payload, signature);
}

async function planRow(id: string) {
  const { rows } = await db.execute<{
    plan_tier: string;
    plan_credits: number | null;
    stripe_subscription_id: string | null;
    auto_topup_enabled: boolean;
    credit_balance: number;
  }>(
    sql`select plan_tier, plan_credits, stripe_subscription_id, auto_topup_enabled, ${creditBalanceProjection} from workspace where id = ${id}`,
  );
  return requiredRow(rows.at(0));
}

function callsOf(op: string) {
  return fake.calls.filter((call) => call.op === op).map((call) => call.args);
}

// Buys Pro with 1,000 credits a month the way a person does: Checkout, then Stripe's invoice.paid.
async function subscribe(workspaceId: string) {
  await createPlanCheckoutSession({
    workspace: await activeWorkspace(workspaceId),
    choice: pro1000,
  });
  const invoice = paidInvoice({
    id: 'in_first',
    choice: pro1000,
    reason: 'subscription_create',
    amountPaid: 1000,
  });
  holdSubscription(pro1000, invoice.id);
  return deliver('invoice.paid', invoice);
}

describe('credits-only mode', () => {
  test('a credits-only deployment refuses every plan action and calls Stripe for none', async () => {
    await writeDeploymentSetting({
      key: 'billingMode',
      value: 'credits_only',
      actorUserId: 'owner',
    });
    const workspace = await activeWorkspace(await seedWorkspace());
    const refusal = { code: 'VALIDATION_FAILED' };
    await expect(getPlanOptions(workspace)).rejects.toMatchObject(refusal);
    await expect(createPlanCheckoutSession({ workspace, choice: pro1000 })).rejects.toMatchObject(
      refusal,
    );
    await expect(changePlan({ workspace, choice: pro2000 })).rejects.toMatchObject(refusal);
    await expect(cancelPlan({ workspace, resume: false })).rejects.toMatchObject(refusal);
    expect((await getTopupOptions({ ...workspace, stripeCustomerId: null })).offersPlans).toBe(
      false,
    );
    expect(fake.calls).toEqual([]);
  });
});

describe('subscription mode', () => {
  test('a first plan is bought through Checkout, its paid invoice grants the credits and lifts the chat limit', async () => {
    const workspaceId = await seedWorkspace();
    await seedCreditBalance(db, workspaceId, 0);
    const workspace = await activeWorkspace(workspaceId);
    expect((await getTopupOptions({ ...workspace, stripeCustomerId: null })).offersPlans).toBe(
      true,
    );
    // Without a plan the workspace runs one chat at a time.
    await db.execute(
      sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, status)
          values ('read_write', ${workspaceId}, 'default', 'owner', 'chat', 'running')`,
    );
    await expect(db.transaction((tx) => assertCanStartChat(workspaceId, tx))).rejects.toMatchObject(
      { code: 'PLAN_LIMIT_REACHED' },
    );

    expect(await createPlanCheckoutSession({ workspace, choice: pro1000 })).toEqual({
      url: 'https://checkout.stripe.test/cs_plan',
    });
    const [params] = requiredRow(callsOf('checkout.create').at(0)) as [
      Stripe.Checkout.SessionCreateParams,
    ];
    expect(params).toMatchObject({
      mode: 'subscription',
      customer: CUSTOMER,
      line_items: [{ price: 'price_plan_pro_month_1000', quantity: 1 }],
      subscription_data: { metadata: { workspace_id: workspaceId, tier: 'pro', credits: '1000' } },
    });

    const invoice = paidInvoice({
      id: 'in_first',
      choice: pro1000,
      reason: 'subscription_create',
      amountPaid: 1000,
    });
    holdSubscription(pro1000, invoice.id);
    const result = await deliver('invoice.paid', invoice);
    expect(result.body).toMatchObject({ workspaceId, credits: 1000 });
    expect(await planRow(workspaceId)).toMatchObject({
      plan_tier: 'pro',
      plan_credits: 1000,
      stripe_subscription_id: SUBSCRIPTION,
      credit_balance: 1000,
    });
    // The billing page shows when this month's plan credits run out; it must be a real date.
    const expiresAt = await getCurrentPlanCreditsExpireAt(workspaceId);
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt?.getTime()).toBeGreaterThan(Date.now());
    // On Pro the second chat runs.
    await expect(
      db.transaction((tx) => assertCanStartChat(workspaceId, tx)),
    ).resolves.toBeUndefined();
    // A workspace with a plan is told to change it, not buy a second one.
    await expect(
      createPlanCheckoutSession({ workspace: await activeWorkspace(workspaceId), choice: pro2000 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('an upgrade charges only the amount the person confirmed and grants what was paid', async () => {
    const workspaceId = await seedWorkspace();
    await subscribe(workspaceId);
    const workspace = await activeWorkspace(workspaceId);

    const preview = await previewPlanChange({ workspace, choice: pro2000 });
    expect(preview).toMatchObject({ amountCents: 500, currency: 'usd' });
    // Without the amount the person saw, nothing is charged.
    await expect(changePlan({ workspace, choice: pro2000 })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // A price that moved since the preview is refused too.
    await expect(
      changePlan({
        workspace,
        choice: pro2000,
        confirmation: { prorationDate: preview.prorationDate, amountCents: 400 },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(callsOf('subscriptions.update')).toEqual([]);

    expect(
      await changePlan({
        workspace,
        choice: pro2000,
        confirmation: { prorationDate: preview.prorationDate, amountCents: 500 },
      }),
    ).toEqual({ effective: 'now' });
    const [[id, params]] = callsOf('subscriptions.update') as [[string, Record<string, unknown>]];
    expect(id).toBe(SUBSCRIPTION);
    expect(params).toMatchObject({
      items: [{ id: 'si_plans', price: 'price_plan_pro_month_2000', quantity: 1 }],
      proration_behavior: 'always_invoice',
      proration_date: preview.prorationDate,
      payment_behavior: 'error_if_incomplete',
    });

    // Stripe charges the difference and tells the app through the subscription update.
    const invoice = paidInvoice({
      id: 'in_upgrade',
      choice: pro2000,
      reason: 'subscription_update',
      amountPaid: 500,
    });
    await deliver('customer.subscription.updated', holdSubscription(pro2000, invoice.id));
    expect(await planRow(workspaceId)).toMatchObject({
      plan_tier: 'pro',
      plan_credits: 2000,
      credit_balance: 1500,
    });
  });

  test('a declined card on an upgrade leaves the plan as it was and passes the decline reason on', async () => {
    const workspaceId = await seedWorkspace();
    await subscribe(workspaceId);
    const workspace = await activeWorkspace(workspaceId);
    const preview = await previewPlanChange({ workspace, choice: pro2000 });
    fake.updateFailure = new Stripe.errors.StripeCardError({
      type: 'card_error',
      message: 'Your card was declined.',
    });
    await expect(
      changePlan({
        workspace,
        choice: pro2000,
        confirmation: { prorationDate: preview.prorationDate, amountCents: preview.amountCents },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'Your card was declined.' });
    expect(await planRow(workspaceId)).toMatchObject({ plan_credits: 1000, credit_balance: 1000 });
  });

  test('a downgrade charges nothing now and takes effect at the renewal', async () => {
    const workspaceId = await seedWorkspace();
    // Start on 2,000 so 1,000 is a step down.
    await createPlanCheckoutSession({
      workspace: await activeWorkspace(workspaceId),
      choice: pro2000,
    });
    const first = paidInvoice({
      id: 'in_first_2000',
      choice: pro2000,
      reason: 'subscription_create',
      amountPaid: 2000,
    });
    holdSubscription(pro2000, first.id);
    await deliver('invoice.paid', first);
    const workspace = await activeWorkspace(workspaceId);

    expect(await changePlan({ workspace, choice: pro1000 })).toEqual({
      effective: 'next_renewal',
    });
    expect(callsOf('subscriptions.update')).toEqual([]);
    expect(callsOf('invoices.preview')).toEqual([]);
    const [[, schedule]] = callsOf('schedules.update') as [
      [string, { phases: Array<{ items: Array<{ price: string }> }> }],
    ];
    expect(schedule.phases.map((phase) => phase.items[0]?.price)).toEqual([
      'price_plan_pro_month_2000',
      'price_plan_pro_month_1000',
    ]);
    expect((await getPlanOptions(workspace)).scheduled).toMatchObject(pro1000);
    expect(await planRow(workspaceId)).toMatchObject({ plan_credits: 2000 });

    // The renewal invoice is for the new package.
    const renewal = paidInvoice({
      id: 'in_renewal',
      choice: pro1000,
      reason: 'subscription_cycle',
      amountPaid: 1000,
    });
    holdSubscription(pro1000, renewal.id);
    await deliver('invoice.paid', renewal);
    expect(await planRow(workspaceId)).toMatchObject({ plan_tier: 'pro', plan_credits: 1000 });
  });

  test('a cancelled plan runs to the period end, can be resumed, and its end keeps bought credits and turns auto top-up off', async () => {
    const workspaceId = await seedWorkspace();
    await subscribe(workspaceId);
    // Credits bought once outlive the plan.
    await db.execute(
      sql`insert into credit_grant (workspace_id, source, source_ref, amount, issued_at, expires_at)
          values (${workspaceId}, 'topup', 'stripe:pi_bought', 300, now() - interval '1 day', now() + interval '300 days')`,
    );
    expect((await planRow(workspaceId)).credit_balance).toBe(1300);
    // Auto top-up needs a plan, so the end of the plan has to switch it off.
    await db.execute(sql`update workspace set auto_topup_enabled = true where id = ${workspaceId}`);
    const workspace = await activeWorkspace(workspaceId);

    const cancelled = await cancelPlan({ workspace, resume: false });
    expect(cancelled.cancelsAt).not.toBeNull();
    expect(callsOf('subscriptions.update').at(-1)?.[1]).toEqual({ cancel_at_period_end: true });
    expect((await getPlanOptions(workspace)).cancelsAt).not.toBeNull();

    expect(await cancelPlan({ workspace, resume: true })).toEqual({ cancelsAt: null });
    expect(callsOf('subscriptions.update').at(-1)?.[1]).toEqual({ cancel_at_period_end: false });
    // Asking again for what is already true calls Stripe no more.
    const updates = callsOf('subscriptions.update').length;
    await cancelPlan({ workspace, resume: true });
    expect(callsOf('subscriptions.update').length).toBe(updates);

    // The period ends: Stripe deletes the subscription.
    const ended = { ...fake.subscription, status: 'canceled' };
    fake.subscription = ended;
    await deliver('customer.subscription.deleted', ended);
    expect(await planRow(workspaceId)).toEqual({
      plan_tier: 'none',
      plan_credits: null,
      stripe_subscription_id: null,
      auto_topup_enabled: false,
      credit_balance: 300,
    });
  });

  test('cancelling drops a waiting downgrade so the plan does not change on its way out', async () => {
    const workspaceId = await seedWorkspace();
    await createPlanCheckoutSession({
      workspace: await activeWorkspace(workspaceId),
      choice: pro2000,
    });
    const first = paidInvoice({
      id: 'in_first_2000',
      choice: pro2000,
      reason: 'subscription_create',
      amountPaid: 2000,
    });
    holdSubscription(pro2000, first.id);
    await deliver('invoice.paid', first);
    const workspace = await activeWorkspace(workspaceId);
    await changePlan({ workspace, choice: pro1000 });

    await cancelPlan({ workspace, resume: false });
    expect(callsOf('schedules.release')).toEqual([['sub_sched']]);
    expect((await getPlanOptions(workspace)).scheduled).toBeNull();
  });

  test('a failed renewal payment notifies the owner and keeps the plan while Stripe retries', async () => {
    const workspaceId = await seedWorkspace();
    await subscribe(workspaceId);
    const open = {
      ...paidInvoice({
        id: 'in_failed',
        choice: pro1000,
        reason: 'subscription_cycle',
        amountPaid: 0,
      }),
      status: 'open',
    };
    fake.invoices.set(open.id, open);
    await deliver('invoice.payment_failed', open);
    const { rows } = await db.execute<{ recipient_user_id: string }>(
      sql`select recipient_user_id from notification where kind = 'payment.failed'`,
    );
    expect(rows).toEqual([{ recipient_user_id: 'owner' }]);
    expect(await planRow(workspaceId)).toMatchObject({ plan_tier: 'pro', plan_credits: 1000 });
  });
});
