// Top-up grants on real Postgres: paid top-up webhooks grant once, and a grant resumes and re-caps open chats.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { STRIPE_API_VERSION } from '@/lib/stripe';
import { creditBalanceProjection, seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { writeGrantForTest } from './helpers/session-grant';
import { makeTestDb, makeTestPool } from './helpers/test-db';

// Resuming posts a `user.message` through the real sendMessage, so the Anthropic client is faked.
const { eventsSendMock, sessionRetrieveMock, sessionUpdateMock } = vi.hoisted(() => ({
  eventsSendMock: vi.fn<
    (
      sessionId: string,
      body: { events: Array<{ type: string; content?: unknown }> },
    ) => Promise<unknown>
  >(async () => ({ data: [] })),
  sessionRetrieveMock: vi.fn(),
  sessionUpdateMock: vi.fn(),
}));
const background = vi.hoisted(() => ({ callbacks: [] as Array<() => unknown> }));

vi.mock('next/server', () => ({
  after: (callback: () => unknown) => background.callbacks.push(callback),
}));
vi.mock('@/features/agents', async (importOriginal) => {
  const boundary = {
    getAnthropicClient: () => ({
      beta: {
        sessions: {
          retrieve: sessionRetrieveMock,
          update: sessionUpdateMock,
          events: { send: eventsSendMock },
        },
      },
    }),
  };
  return {
    ...(await importOriginal<typeof import('@/features/agents')>()),
    ...boundary,
    requireAnthropicClient: boundary.getAnthropicClient,
  };
});

/** Sessions that received the credit resume message, in send order. */
function resumedSessionIds(): string[] {
  return eventsSendMock.mock.calls
    .filter(([, body]) =>
      body.events.some(
        (event) =>
          event.type === 'user.message' &&
          JSON.stringify(event.content).includes(RESUME_MESSAGE_TEXT),
      ),
    )
    .map(([sessionId]) => sessionId);
}

const billing = await import('@/features/billing');
const resumes = await import('@/features/billing/api/resume-paused-sessions');
const { withRequestContext } = await import('@/lib/request-context');
const { RESUME_MESSAGE_TEXT } = billing;

// Each entry point runs inside a request context, as the webhook route or the resume action opens one.
function inRequest<A extends unknown[], R>(entry: (...args: A) => Promise<R>) {
  return (...args: A) => withRequestContext({ route: 'test' }, () => entry(...args));
}
const processStripeWebhook = inRequest(billing.processStripeWebhook);
const grantTopupAndResume = inRequest(billing.grantTopupAndResume);
const resumeSessionExplicitly = inRequest(resumes.resumeSessionExplicitly);
const resumePausedSessions = inRequest(resumes.resumePausedSessions);
const { ensureCustomer } = await import('@/features/billing/api/ensure-customer');
const { consumeWorkspaceCredits } = await import('@/features/billing/api/credit-ledger');

// Spends credits through the ledger so a wrong second grant would show in the balance.
async function spendTo(workspaceId: string, from: number, to: number) {
  await db.transaction((tx) => consumeWorkspaceCredits(tx, { workspaceId, credits: from - to }));
}

async function grantRefCount(sourceRef: string): Promise<number> {
  const { rows } = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from credit_grant where source_ref = ${sourceRef}`,
  );
  return requiredRow(rows.at(0)).count;
}

const pool = makeTestPool();
const db = makeTestDb(pool);

const WEBHOOK_SECRET = 'whsec_test_secret_for_signature_tests';
const stripe = new Stripe('sk_test_dummy_for_offline_signature_tests', {
  apiVersion: STRIPE_API_VERSION,
});

const ORG = 'org_topup';
const USER = 'user_topup';
const CUSTOMER_ID = 'cus_test_topup';

// A `checkout.session.completed` shaped like the dahlia API for a one-off top-up:
// mode=payment, payment_status=paid, credits stamped on session.metadata. The grant
// keys on the session's `payment_intent`, so the event carries one (a paid payment-mode
// session always has an intent).
function buildCheckoutCompletedEvent(opts: {
  eventId: string;
  checkoutSessionId: string;
  customerId: string;
  credits: number;
  mode?: string;
  paymentStatus?: string;
  paymentIntentId?: string;
}): Record<string, unknown> {
  return {
    id: opts.eventId,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: 1_700_000_000,
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: opts.checkoutSessionId,
        object: 'checkout.session',
        mode: opts.mode ?? 'payment',
        payment_status: opts.paymentStatus ?? 'paid',
        customer: opts.customerId,
        payment_intent: opts.paymentIntentId ?? `pi_for_${opts.checkoutSessionId}`,
        metadata: {
          kind: 'topup',
          credits: String(opts.credits),
          workspace_id: 'ws_unused_here',
          organization_id: ORG,
        },
      },
    },
  };
}

// A `payment_intent.succeeded` for the DIRECT off-session top-up path: the intent
// carries the same top-up metadata (kind/credits) the Checkout path stamps on its
// session, and the grant keys on the intent id.
function buildPaymentIntentSucceededEvent(opts: {
  eventId: string;
  paymentIntentId: string;
  customerId: string;
  credits: number;
  kind?: string;
}): Record<string, unknown> {
  return {
    id: opts.eventId,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: 1_700_000_000,
    type: 'payment_intent.succeeded',
    livemode: false,
    data: {
      object: {
        id: opts.paymentIntentId,
        object: 'payment_intent',
        status: 'succeeded',
        customer: opts.customerId,
        metadata: {
          kind: opts.kind ?? 'topup',
          credits: String(opts.credits),
          workspace_id: 'ws_unused_here',
          organization_id: ORG,
        },
      },
    },
  };
}

async function signedDelivery(event: Record<string, unknown>): Promise<{
  payload: string;
  signature: string;
}> {
  const payload = JSON.stringify(event);
  const signature = await stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, signature };
}

async function seedWorkspaceWithCustomer(initialBalance: number): Promise<string> {
  await seedOrganization(db, ORG);
  await seedUser(db, USER);
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('billing-owner', ${ORG}, ${USER}, 'owner', now()) on conflict do nothing`,
  );
  const id = randomUUID();
  await db.execute(
    sql`insert into workspace (id, organization_id, name, stripe_customer_id)
        values (${id}, ${ORG}, ${'Topup WS'}, ${CUSTOMER_ID})`,
  );
  await seedCreditBalance(db, id, initialBalance);
  return id;
}

async function seedPausedSession(
  workspaceId: string,
  anthropicSessionId: string,
  // Auto-resume requires a recent pause; use the present instant for happy-path fixtures.
  pausedAt: Date | null = new Date(),
): Promise<string> {
  const id = randomUUID();
  await db.execute(
    sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id, paused_at, paused_reason)
        values ('read_write', ${id}, ${workspaceId}, ${'default'}, ${USER}, ${'chat'}, ${'paused_no_credits'}, ${anthropicSessionId}, ${pausedAt}, 'credits')`,
  );
  return id;
}

async function seedSessionWithStatus(
  workspaceId: string,
  anthropicSessionId: string,
  status: 'idle' | 'running' | 'terminated',
): Promise<string> {
  const id = randomUUID();
  await db.execute(
    sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id)
        values ('read_write', ${id}, ${workspaceId}, ${'default'}, ${USER}, ${'chat'}, ${status}, ${anthropicSessionId})`,
  );
  return id;
}

async function balanceOf(workspaceId: string): Promise<number> {
  const { rows } = await db.execute<{ credit_balance: number }>(
    sql`select ${creditBalanceProjection} from workspace where id = ${workspaceId}`,
  );
  return requiredRow(rows.at(0)).credit_balance;
}

async function statusOf(sessionId: string): Promise<string> {
  const { rows } = await db.execute<{ status: string }>(
    sql`select status from session where id = ${sessionId}`,
  );
  return requiredRow(rows.at(0)).status;
}

beforeAll(async () => {
  await applyMigrations(db);
});

beforeEach(async () => {
  await truncateAll(db);
  eventsSendMock.mockReset();
  eventsSendMock.mockResolvedValue({ data: [] });
  sessionRetrieveMock.mockReset();
  sessionRetrieveMock.mockImplementation(async () => ({
    usage: { list_cost: { amount: '0', currency: 'USD' } },
    budget: { type: 'limit', max_list_cost: { amount: '1', currency: 'USD' } },
    status: 'idle',
  }));
  sessionUpdateMock.mockReset();
  sessionUpdateMock.mockResolvedValue({});
});

async function flushBackgroundWork(): Promise<void> {
  while (background.callbacks.length > 0) {
    const callbacks = background.callbacks.splice(0);
    await Promise.all(callbacks.map(async (callback) => callback()));
  }
}

afterEach(async () => {
  await flushBackgroundWork();
});

afterAll(async () => {
  await pool.end();
});

describe('the first checkout creates the Stripe customer', () => {
  test('two concurrent first checkouts end on one Stripe customer', async () => {
    await seedOrganization(db, ORG);
    await seedUser(db, USER);
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role, created_at) values ('billing-owner', ${ORG}, ${USER}, 'owner', now()) on conflict do nothing`,
    );
    const workspaceId = randomUUID();
    await db.execute(
      sql`insert into workspace (id, organization_id, name)
          values (${workspaceId}, ${ORG}, ${'Lazy customer WS'})`,
    );
    const createCustomer = vi.spyOn(stripe.customers, 'create').mockResolvedValue({
      id: 'cus_lazy_once',
      object: 'customer',
      lastResponse: { headers: {}, requestId: 'req_lazy_once', statusCode: 200 },
    } as Stripe.Response<Stripe.Customer>);
    const activeWorkspace = {
      id: workspaceId,
      organizationId: ORG,
      name: 'Lazy customer WS',
      creditBalance: 0,
      creditResetAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      planTier: 'none' as const,
      planBillingInterval: null,
      planCredits: null,
      autoTopupEnabled: false,
      autoTopupThresholdCredits: 20,
      autoTopupCredits: 400,
      autoTopupMonthlyCapCents: 25_000,
      userEmail: 'lazy@example.test',
      userId: USER,
    };

    const [first, second] = await Promise.all([
      ensureCustomer(stripe, activeWorkspace),
      ensureCustomer(stripe, activeWorkspace),
    ]);

    expect(first).toBe('cus_lazy_once');
    expect(second).toBe('cus_lazy_once');
    // The external creates can race, but both carry the same Stripe idempotency
    // key and the DB compare-and-set publishes the one returned customer id.
    expect(createCustomer).toHaveBeenCalledTimes(2);
    expect(createCustomer).toHaveBeenCalledWith(expect.any(Object), {
      idempotencyKey: `billing-customer:${workspaceId}:0`,
    });
    const { rows } = await db.execute<{ stripe_customer_id: string }>(
      sql`select stripe_customer_id from workspace where id = ${workspaceId}`,
    );
    expect(requiredRow(rows.at(0)).stripe_customer_id).toBe('cus_lazy_once');
    createCustomer.mockRestore();
  });
});

describe('a paid top-up webhook grants once', () => {
  test.each([
    ['checkout.session.completed', 'evt_topup_add', 'pi_topup_add'],
    ['payment_intent.succeeded', 'evt_pi_add', 'pi_direct_add'],
  ] as const)('%s adds the credits to the balance, keyed on the intent, and a redelivery after spending adds nothing', async (type, eventId, intentId) => {
    const wsId = await seedWorkspaceWithCustomer(100);
    const event =
      type === 'checkout.session.completed'
        ? buildCheckoutCompletedEvent({
            eventId,
            checkoutSessionId: `cs_${intentId}`,
            paymentIntentId: intentId,
            customerId: CUSTOMER_ID,
            credits: 500,
          })
        : buildPaymentIntentSucceededEvent({
            eventId,
            paymentIntentId: intentId,
            customerId: CUSTOMER_ID,
            credits: 500,
          });
    const { payload, signature } = await signedDelivery(event);

    const first = await processStripeWebhook(payload, signature);
    expect(first).toMatchObject({
      status: 200,
      body: { received: true, credits: 500, applied: true },
    });
    expect(await balanceOf(wsId)).toBe(600);
    expect(await grantRefCount(`stripe:${intentId}`)).toBe(1);
    const { rows: receipts } = await db.execute<{ event_id: string; payload: unknown }>(
      sql`select event_id, payload from processed_webhook_event where provider = 'stripe'`,
    );
    expect(receipts).toEqual([{ event_id: eventId, payload: null }]);

    // Spend between deliveries so a wrong second grant would show.
    await spendTo(wsId, 600, 123);
    const replay = await processStripeWebhook(payload, signature);
    expect(replay).toMatchObject({ status: 200, body: { applied: false } });
    expect(await balanceOf(wsId)).toBe(123);
  });

  test.each([
    ['ahead of', 60_000],
    ['behind', -60_000],
  ])('paid credits are spendable at once when the app clock runs %s the database', async (_label, skewMs) => {
    const wsId = await seedWorkspaceWithCustomer(100);
    const sessionId = await seedPausedSession(wsId, 'asess_clock_skew');
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + skewMs });
    try {
      const { payload, signature } = await signedDelivery(
        buildCheckoutCompletedEvent({
          eventId: `evt_topup_skew_${skewMs}`,
          checkoutSessionId: `cs_topup_skew_${skewMs}`,
          paymentIntentId: `pi_topup_skew_${skewMs}`,
          customerId: CUSTOMER_ID,
          credits: 500,
        }),
      );
      const result = await processStripeWebhook(payload, signature);
      expect(result.body).toMatchObject({ applied: true, balance: 600, resumed: 1 });
    } finally {
      vi.useRealTimers();
    }
    expect(await balanceOf(wsId)).toBe(600);
    expect(await statusOf(sessionId)).toBe('running');
  });

  test('two concurrent deliveries of one purchase grant once', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const { payload, signature } = await signedDelivery(
      buildCheckoutCompletedEvent({
        eventId: 'evt_topup_race',
        checkoutSessionId: 'cs_topup_race',
        paymentIntentId: 'pi_topup_race',
        customerId: CUSTOMER_ID,
        credits: 700,
      }),
    );
    const results = await Promise.all([
      processStripeWebhook(payload, signature),
      processStripeWebhook(payload, signature),
    ]);
    expect(results.map((result) => result.body.applied).sort()).toEqual([false, true]);
    expect(await balanceOf(wsId)).toBe(700);
    expect(await grantRefCount('stripe:pi_topup_race')).toBe(1);
  });

  test('a Checkout purchase that fires both checkout and payment_intent events grants once', async () => {
    // Both events carry the same PaymentIntent id, which is the grant's key.
    const wsId = await seedWorkspaceWithCustomer(0);
    const SHARED_PI = 'pi_cofire';

    const checkout = await signedDelivery(
      buildCheckoutCompletedEvent({
        eventId: 'evt_cofire_checkout',
        checkoutSessionId: 'cs_cofire',
        paymentIntentId: SHARED_PI,
        customerId: CUSTOMER_ID,
        credits: 500,
      }),
    );
    const intent = await signedDelivery(
      buildPaymentIntentSucceededEvent({
        eventId: 'evt_cofire_intent',
        paymentIntentId: SHARED_PI,
        customerId: CUSTOMER_ID,
        credits: 500,
      }),
    );

    const first = await processStripeWebhook(checkout.payload, checkout.signature);
    expect(first.body).toMatchObject({ applied: true });
    expect(await balanceOf(wsId)).toBe(500);

    const second = await processStripeWebhook(intent.payload, intent.signature);
    expect(second.body).toMatchObject({ applied: false }); // the shared intent id is one grant
    expect(await balanceOf(wsId)).toBe(500); // not 1000 — granted exactly once
  });

  test('a duplicate grant from the webhook and the confirm fallback grants and resumes once', async () => {
    const wsId = await seedWorkspaceWithCustomer(10);
    await seedPausedSession(wsId, 'asess_once');
    const grant = { customerId: CUSTOMER_ID, credits: 500 };

    expect((await grantTopupAndResume('pi_shared', grant)).kind).toBe('granted');
    expect((await grantTopupAndResume('pi_shared', grant)).kind).toBe('replayed');

    expect(resumedSessionIds()).toEqual(['asess_once']);
    expect(await balanceOf(wsId)).toBe(510);
  });

  test.each([
    [
      'a subscription Checkout',
      () =>
        buildCheckoutCompletedEvent({
          eventId: 'evt_sub_checkout',
          checkoutSessionId: 'cs_sub',
          customerId: CUSTOMER_ID,
          credits: 400,
          mode: 'subscription',
        }),
      'checkout.session.completed:non-payment',
    ],
    [
      'a payment intent that is not a top-up',
      () =>
        buildPaymentIntentSucceededEvent({
          eventId: 'evt_pi_legacy',
          paymentIntentId: 'pi_legacy',
          customerId: CUSTOMER_ID,
          credits: 2400,
          kind: 'legacy',
        }),
      'payment_intent.succeeded:legacy',
    ],
  ])('%s grants no top-up credits, because another handler owns that payment', async (_label, build, ignored) => {
    const wsId = await seedWorkspaceWithCustomer(50);
    const { payload, signature } = await signedDelivery(build());
    expect((await processStripeWebhook(payload, signature)).body).toMatchObject({ ignored });
    expect(await balanceOf(wsId)).toBe(50);
  });
});

describe('a top-up keeps open chats in step with the new balance', () => {
  test('a top-up resumes a chat paused for credits and posts the continuation', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const sessionId = await seedPausedSession(wsId, 'asess_paused_1');
    const { payload, signature } = await signedDelivery(
      buildCheckoutCompletedEvent({
        eventId: 'evt_topup_resume',
        checkoutSessionId: 'cs_topup_resume',
        customerId: CUSTOMER_ID,
        credits: 500,
      }),
    );

    const result = await processStripeWebhook(payload, signature);

    expect(result.body).toMatchObject({ resumed: 1 });
    expect(await statusOf(sessionId)).toBe('running');
    expect(resumedSessionIds()).toContain('asess_paused_1');
  });

  test('a top-up resumes only chats paused within the last 30 minutes', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const recentId = await seedPausedSession(
      wsId,
      'asess_recent',
      new Date(Date.now() - 5 * 60 * 1000), // 5 min ago → inside the window
    );
    const staleId = await seedPausedSession(
      wsId,
      'asess_stale',
      new Date(Date.now() - 45 * 60 * 1000), // 45 min ago → past the cutoff
    );
    const legacyId = await seedPausedSession(wsId, 'asess_legacy', new Date(0));

    await grantTopupAndResume('cs_cutoff', { customerId: CUSTOMER_ID, credits: 500 });

    await flushBackgroundWork();
    expect(sessionUpdateMock.mock.calls.map((call) => call[0])).not.toContain('asess_stale');
    expect(await statusOf(recentId)).toBe('running');
    expect(await statusOf(staleId)).toBe('paused_no_credits');
    expect(await statusOf(legacyId)).toBe('paused_no_credits');
    expect(resumedSessionIds()).toHaveLength(1);
    expect(resumedSessionIds()).toContain('asess_recent');
  });

  test('a top-up raises the cap of a chat paused by it and posts no second continuation when it already runs', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const budgetId = await seedPausedSession(wsId, 'asess_budget_cap');
    await db.execute(sql`update session set paused_reason = 'budget' where id = ${budgetId}`);
    sessionRetrieveMock
      .mockResolvedValueOnce({
        usage: { list_cost: { amount: '0', currency: 'USD' } },
        budget: { type: 'limit', max_list_cost: { amount: '1', currency: 'USD' } },
        status: 'idle',
      })
      .mockResolvedValueOnce({ status: 'running' });

    await grantTopupAndResume('cs_budget_cap', { customerId: CUSTOMER_ID, credits: 500 });
    await flushBackgroundWork();

    expect(await statusOf(budgetId)).toBe('running');
    expect(resumedSessionIds()).toEqual([]);
    expect(sessionUpdateMock).toHaveBeenCalledWith(
      'asess_budget_cap',
      {
        budget: { type: 'limit', max_list_cost: { amount: '500', currency: 'USD' } },
      },
      { timeout: 30_000, maxRetries: 0 },
    );
    await expect(
      resumeSessionExplicitly(
        writeGrantForTest({
          workspaceId: wsId,
          organizationId: ORG,
          userId: USER,
          anthropicSessionId: 'asess_budget_cap',
          sessionRowId: budgetId,
        }),
      ),
    ).resolves.toEqual({ resumed: false });
    expect(await statusOf(budgetId)).toBe('running');
  });

  test('a chat still idle after its cap was raised gets exactly one continuation', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const budgetId = await seedPausedSession(wsId, 'asess_budget_idle');
    await db.execute(sql`update session set paused_reason = 'budget' where id = ${budgetId}`);
    sessionRetrieveMock
      .mockResolvedValueOnce({
        usage: { list_cost: { amount: '0', currency: 'USD' } },
        budget: { type: 'limit', max_list_cost: { amount: '1', currency: 'USD' } },
        status: 'idle',
      })
      .mockResolvedValueOnce({ status: 'idle' });

    await grantTopupAndResume('cs_budget_still_idle', {
      customerId: CUSTOMER_ID,
      credits: 500,
    });
    await flushBackgroundWork();

    expect(await statusOf(budgetId)).toBe('running');
    expect(resumedSessionIds()).toHaveLength(1);
    expect(resumedSessionIds()).toContain('asess_budget_idle');
  });

  test('a top-up raises the cap of running and paused chats by the new balance and skips idle and ended ones', async () => {
    const wsId = await seedWorkspaceWithCustomer(14);
    await seedSessionWithStatus(wsId, 'asess_running_budget', 'running');
    const pausedId = await seedPausedSession(wsId, 'asess_paused_budget');
    await db.execute(sql`update session set paused_reason = 'budget' where id = ${pausedId}`);
    await seedSessionWithStatus(wsId, 'asess_idle_budget', 'idle');
    await seedSessionWithStatus(wsId, 'asess_terminated_budget', 'terminated');
    sessionRetrieveMock.mockImplementation(async (sessionId: string) => ({
      usage: {
        list_cost: { amount: sessionId === 'asess_running_budget' ? '20' : '7', currency: 'USD' },
      },
      budget: { type: 'limit', max_list_cost: { amount: '14', currency: 'USD' } },
      status: 'running',
    }));

    await grantTopupAndResume('pi_refresh_open_sessions', {
      customerId: CUSTOMER_ID,
      credits: 500,
    });
    await flushBackgroundWork();

    expect(sessionUpdateMock).toHaveBeenCalledTimes(2);
    expect(sessionUpdateMock).toHaveBeenCalledWith(
      'asess_running_budget',
      {
        budget: { type: 'limit', max_list_cost: { amount: '534', currency: 'USD' } },
      },
      { timeout: 30_000, maxRetries: 0 },
    );
    expect(sessionUpdateMock).toHaveBeenCalledWith(
      'asess_paused_budget',
      {
        budget: { type: 'limit', max_list_cost: { amount: '521', currency: 'USD' } },
      },
      { timeout: 30_000, maxRetries: 0 },
    );
    expect(sessionRetrieveMock).not.toHaveBeenCalledWith('asess_idle_budget');
    expect(sessionRetrieveMock).not.toHaveBeenCalledWith('asess_terminated_budget');
  });

  test('a top-up raises the cap of every open chat, not only the first 25', async () => {
    const wsId = await seedWorkspaceWithCustomer(14);
    const sessionIds: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      const anthropicSessionId = `asess_bounded_${index}`;
      const localId = await seedSessionWithStatus(wsId, anthropicSessionId, 'running');
      sessionIds.push(anthropicSessionId);
      await db.execute(
        sql`update session set last_event_at = ${new Date(Date.now() + index * 1_000)}
            where id = ${localId}`,
      );
    }

    await grantTopupAndResume('pi_bounded_refresh', {
      customerId: CUSTOMER_ID,
      credits: 500,
    });
    await flushBackgroundWork();

    expect(sessionUpdateMock).toHaveBeenCalledTimes(26);
    expect(sessionRetrieveMock.mock.calls.some(([id]) => id === sessionIds.at(0))).toBe(true);
    expect(sessionRetrieveMock.mock.calls.some(([id]) => id === sessionIds.at(25))).toBe(true);
  });

  test('an old pause needs an explicit resume, refused without credits and posting one continuation after a top-up', async () => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const staleId = await seedPausedSession(
      wsId,
      'asess_explicit',
      new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago — far past the cutoff
    );

    // Still no credits → refused with CREDITS_EXHAUSTED, session stays paused.
    await expect(
      resumeSessionExplicitly(
        writeGrantForTest({
          workspaceId: wsId,
          organizationId: ORG,
          userId: USER,
          anthropicSessionId: 'asess_explicit',
          sessionRowId: staleId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'CREDITS_EXHAUSTED' });
    expect(await statusOf(staleId)).toBe('paused_no_credits');

    // Old pauses require an explicit resume.
    await grantTopupAndResume('cs_explicit', { customerId: CUSTOMER_ID, credits: 500 });
    expect(await statusOf(staleId)).toBe('paused_no_credits');

    // …then the explicit Resume goes through and posts the continuation.
    const result = await resumeSessionExplicitly(
      writeGrantForTest({
        workspaceId: wsId,
        organizationId: ORG,
        userId: USER,
        anthropicSessionId: 'asess_explicit',
        sessionRowId: staleId,
      }),
    );
    expect(result).toEqual({ resumed: true });
    expect(await statusOf(staleId)).toBe('running');
    expect(resumedSessionIds()).toContain('asess_explicit');
  });

  test('an explicit resume stays paused when raising the cap fails', async () => {
    const wsId = await seedWorkspaceWithCustomer(500);
    const pausedId = await seedPausedSession(wsId, 'asess_refresh_failure');
    sessionUpdateMock.mockRejectedValueOnce(new Error('Anthropic unavailable'));

    await expect(
      resumeSessionExplicitly(
        writeGrantForTest({
          workspaceId: wsId,
          organizationId: ORG,
          userId: USER,
          anthropicSessionId: 'asess_refresh_failure',
          sessionRowId: pausedId,
        }),
      ),
    ).rejects.toThrow();
    expect(await statusOf(pausedId)).toBe('paused_no_credits');
    expect(resumedSessionIds()).toEqual([]);
  });

  test('a chat deleted upstream does not leave the workspace stuck waiting for a cap raise', async () => {
    const { NotFoundError } = await import('@anthropic-ai/sdk');
    const { syncWorkspaceSessionBudgetsAfterGrant } = await import(
      '@/features/billing/api/sync-session-budgets'
    );
    const workspaceId = await seedWorkspaceWithCustomer(100);
    await seedSessionWithStatus(workspaceId, 'asess_gone', 'running');
    sessionRetrieveMock.mockRejectedValue(
      new NotFoundError(
        404,
        { error: { type: 'not_found_error', message: 'Session removed' } },
        'Session removed',
        new Headers(),
      ),
    );
    const result = await syncWorkspaceSessionBudgetsAfterGrant(workspaceId);
    expect(result.failedSessionIds).toEqual([]);
    expect(sessionUpdateMock).not.toHaveBeenCalled();
    expect(
      (await db.execute(sql`select budget_sync_status from workspace where id = ${workspaceId}`))
        .rows,
    ).toEqual([{ budget_sync_status: 'idle' }]);
  });

  test('one chat refusing its continuation does not stop the others resuming', async () => {
    const { APIError } = await import('@anthropic-ai/sdk');
    const wsId = await seedWorkspaceWithCustomer(500);
    await seedPausedSession(wsId, 'refused');
    const good = await seedPausedSession(wsId, 'accepted');
    eventsSendMock.mockImplementation(async (sessionId) => {
      if (sessionId === 'refused')
        throw new APIError(400, {}, 'waiting for tool result', new Headers());
      return { data: [] };
    });
    await expect(resumePausedSessions(wsId, { budgetRaisedSessionIds: [] })).resolves.toHaveLength(
      1,
    );
    expect(await statusOf(good)).toBe('running');
  });

  test.each([
    'opening',
    'resuming',
  ])('a top-up raises the cap of a chat that is %s', async (status) => {
    const wsId = await seedWorkspaceWithCustomer(0);
    const id = await seedPausedSession(wsId, `inflight_${status}`);
    if (status === 'opening')
      await db.execute(
        sql`update session set status='opening',paused_at=null,paused_reason=null where id=${id}`,
      );
    else await db.execute(sql`update session set status='resuming' where id=${id}`);
    await grantTopupAndResume(`grant_${status}`, { customerId: CUSTOMER_ID, credits: 500 });
    await flushBackgroundWork();
    expect(sessionUpdateMock).toHaveBeenCalledWith(`inflight_${status}`, expect.any(Object), {
      timeout: 30_000,
      maxRetries: 0,
    });
  });
});
