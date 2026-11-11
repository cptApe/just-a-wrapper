// The credit ledger and billing state machines on real Postgres: grants, time-driven balances, terminal states, leases and receipts.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  autoTopupAttempt,
  creditGrant,
  processedWebhookEvent,
  session,
  usageEvent,
  workspace,
} from '@/db/schema';
import { persistAutoTopupSettings } from '@/features/billing/api/auto-topup-settings-transitions';
import { moveAutoTopupAttempt } from '@/features/billing/api/auto-topup-transitions';
import {
  claimBudgetSync,
  finishBudgetSync,
  renewBudgetSyncLease,
  requestBudgetSync,
} from '@/features/billing/api/budget-sync-transitions';
import {
  retireCreditGrants,
  updateGrantConsumption,
} from '@/features/billing/api/credit-grant-transitions';
import {
  getLiveCreditBalance,
  grantWelcomeCredits,
  issueCreditGrant,
} from '@/features/billing/api/credit-ledger';
import {
  claimStripeCustomer,
  deleteStripeCustomer,
} from '@/features/billing/api/customer-transitions';
import { lockLiveLedger } from '@/features/billing/api/ledger-lock';
import {
  applyPlanEntitlement,
  endPlanEntitlement,
} from '@/features/billing/api/subscription-transitions';
import { completeUsageSettlement } from '@/features/billing/api/usage-settlement-transitions';
import { pruneWebhookReceipts } from '@/features/jobs/api/prune-webhook-receipts';
import { balanceAt, withLockedLedger } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

// The shipped configuration grants no welcome credits; a fork that sets an amount is what the welcome cases guard.
vi.mock('@/features/billing/pricing-config', async (actual) =>
  (await import('./helpers/seams')).pricingWith(actual, { WELCOME_CREDITS: 100 }),
);

const pool = makeTestPool();
const database = makeTestDb(pool);
let workspaceId: string;
beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  await truncateAll(database);
  await seedOrganization(database, 'billing-machines');
  workspaceId = randomUUID();
  await database
    .insert(workspace)
    .values({ id: workspaceId, organizationId: 'billing-machines', name: 'Billing' });
});
afterAll(() => pool.end());
const grant = {
  tier: 'pro' as const,
  period: { start: 0, end: 1 },
  credits: 1000,
  interval: 'month' as const,
  customerId: 'customer',
  subscriptionId: 'subscription',
};

describe('subscription entitlement', () => {
  test('a second subscription can neither replace nor end the active one', async () => {
    await database.transaction(async (transaction) => {
      expect(
        await applyPlanEntitlement(transaction, {
          workspaceId,
          subscriptionId: 'first',
          grant,
          resetAt: new Date(),
        }),
      ).toBe(true);
      expect(
        await applyPlanEntitlement(transaction, {
          workspaceId,
          subscriptionId: 'second',
          grant,
          resetAt: new Date(),
        }),
      ).toBe(false);
      expect(await endPlanEntitlement(transaction, workspaceId, 'second')).toBe(false);
      expect(await endPlanEntitlement(transaction, workspaceId, 'first')).toBe(true);
      expect(await endPlanEntitlement(transaction, workspaceId, 'first')).toBe(false);
    });
  });
  test('a deleted workspace cannot be given a plan', async () => {
    await database
      .update(workspace)
      .set({ deletedAt: new Date(), lifecycleStatus: 'deleted' })
      .where(eq(workspace.id, workspaceId));
    await database.transaction(async (transaction) => {
      expect(
        await applyPlanEntitlement(transaction, {
          workspaceId,
          subscriptionId: 'first',
          grant,
          resetAt: null,
        }),
      ).toBe(false);
    });
  });
});
test.each([
  'succeeded',
  'failed',
  'superseded',
] as const)('an automatic purchase that %s cannot be reopened or re-marked by a late write', async (status) => {
  const id = randomUUID();
  await database.insert(autoTopupAttempt).values({
    id,
    workspaceId,
    credits: 1000,
    amountCents: 1000,
    status: 'charging',
    paymentMethodId: 'pm_1',
  });
  await database.transaction(async (transaction) => {
    expect(
      await moveAutoTopupAttempt(
        transaction,
        status === 'superseded' ? { id, status } : { id, status, paymentIntentId: 'pi_1' },
      ),
    ).toBe(true);
    expect(
      await moveAutoTopupAttempt(transaction, { id, status: 'pending', paymentIntentId: 'pi_2' }),
    ).toBe(false);
    expect(
      await moveAutoTopupAttempt(transaction, { id, status: 'succeeded', paymentIntentId: 'pi_1' }),
    ).toBe(false);
  });
});
test('retired credits leave the balance, cannot be retired twice and cannot be spent', async () => {
  await withLockedLedger(database, workspaceId, async (ledger) => {
    await issueCreditGrant(ledger, {
      source: 'plan',
      sourceRef: 'test',
      amount: 100,
      issuedAt: 'now',
      expiresAt: new Date('2040-01-01'),
    });
    expect(await retireCreditGrants(ledger, eq(creditGrant.sourceRef, 'test'))).toBe(true);
    expect(await retireCreditGrants(ledger, eq(creditGrant.sourceRef, 'test'))).toBe(false);
  });
  expect(await getLiveCreditBalance(workspaceId)).toBe(0);
  const [row] = await database.select().from(creditGrant);
  expect(row).toMatchObject({ status: 'retired', consumed: 0 });
  if (!row) throw new Error('Expected retired grant');
  expect(
    await withLockedLedger(database, workspaceId, (ledger) =>
      updateGrantConsumption(ledger, row.id, 10),
    ),
  ).toBe(false);
});
test('scheduled credits become spendable and expire on their dates with no job running', async () => {
  await database.insert(creditGrant).values({
    workspaceId,
    source: 'plan',
    sourceRef: 'future',
    amount: 500,
    issuedAt: new Date('2030-02-01'),
    expiresAt: new Date('2030-03-01'),
  });
  expect(await getLiveCreditBalance(workspaceId)).toBe(0);
  expect(await balanceAt(database, workspaceId, new Date('2030-01-31'))).toBe(0);
  expect(await balanceAt(database, workspaceId, new Date('2030-02-01'))).toBe(500);
  expect(await balanceAt(database, workspaceId, new Date('2030-03-01'))).toBe(0);
});

test('a dated grant must start after the database clock, so the app clock cannot stamp spendable credit', async () => {
  await expect(
    withLockedLedger(database, workspaceId, (ledger) =>
      issueCreditGrant(ledger, {
        source: 'topup',
        sourceRef: 'app-clock',
        amount: 100,
        issuedAt: new Date(ledger.now.getTime() - 1),
        expiresAt: new Date('2040-01-01'),
      }),
    ),
  ).rejects.toMatchObject({ code: 'UNEXPECTED' });
  const issued = await withLockedLedger(database, workspaceId, async (ledger) => {
    expect(
      await issueCreditGrant(ledger, {
        source: 'topup',
        sourceRef: 'database-clock',
        amount: 100,
        issuedAt: 'now',
        expiresAt: new Date('2040-01-01'),
      }),
    ).toBe(true);
    return ledger.now;
  });
  const [row] = await database
    .select()
    .from(creditGrant)
    .where(eq(creditGrant.sourceRef, 'database-clock'));
  expect(row?.issuedAt.getTime()).toBe(issued.getTime());
  expect(await getLiveCreditBalance(workspaceId)).toBe(100);
});

test('a usage charge is settled at most once', async () => {
  await seedUser(database, 'settlement-user');
  const sessionId = randomUUID();
  await database.insert(session).values({
    workspaceMemoryAccess: 'read_write',
    id: sessionId,
    workspaceId,
    createdByUserId: 'settlement-user',
    tier: 'default',
    kind: 'chat',
  });
  await database.insert(usageEvent).values({
    workspaceId,
    eventType: 'tool_call',
    usageKey: 'pending_usage',
    sessionId,
    creditsDelta: -1,
    settlementStatus: 'pending',
  });
  expect(await completeUsageSettlement('pending_usage')).toBe(true);
  expect(await completeUsageSettlement('pending_usage')).toBe(false);
});

test('a stale Stripe customer claim or deletion cannot overwrite the current customer', async () => {
  expect(await claimStripeCustomer({ workspaceId, customerId: 'cus_first', generation: 0 })).toBe(
    true,
  );
  expect(await claimStripeCustomer({ workspaceId, customerId: 'cus_racer', generation: 0 })).toBe(
    false,
  );
  await deleteStripeCustomer('cus_first');
  expect(await claimStripeCustomer({ workspaceId, customerId: 'cus_stale', generation: 0 })).toBe(
    false,
  );
  expect(await claimStripeCustomer({ workspaceId, customerId: 'cus_second', generation: 1 })).toBe(
    true,
  );
  await deleteStripeCustomer('cus_first');
  const current = (await database.select().from(workspace).where(eq(workspace.id, workspaceId))).at(
    0,
  );
  expect(current?.stripeCustomerId).toBe('cus_second');
});

test('the card frozen on an automatic purchase cannot be swapped mid-charge', async () => {
  const id = randomUUID();
  await database
    .insert(autoTopupAttempt)
    .values({ id, workspaceId, credits: 1000, amountCents: 1000 });
  const freeze = (paymentMethodId: string) =>
    moveAutoTopupAttempt(database, { id, status: 'charging', paymentMethodId });
  expect(await freeze('pm_first')).toBe(true);
  expect(await freeze('pm_changed')).toBe(false);
  const [row] = await database.select().from(autoTopupAttempt).where(eq(autoTopupAttempt.id, id));
  expect(row).toMatchObject({ status: 'charging', paymentMethodId: 'pm_first' });
});

test('a workspace holds at most one open automatic top-up, even without the row lock', async () => {
  const racers = await Promise.allSettled(
    [0, 1].map(() =>
      database.transaction((transaction) =>
        transaction
          .insert(autoTopupAttempt)
          .values({ workspaceId, credits: 1000, amountCents: 1000 }),
      ),
    ),
  );
  expect(racers.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  await expect(
    database.insert(autoTopupAttempt).values({
      workspaceId,
      credits: 1000,
      amountCents: 1000,
      status: 'pending',
      stripePaymentIntentId: 'pi_open',
    }),
  ).rejects.toThrow();
  await database
    .insert(autoTopupAttempt)
    .values({ workspaceId, credits: 1000, amountCents: 1000, status: 'failed' });
});

test('a chat cap raise runs in one process at a time and a request arriving meanwhile is not lost', async () => {
  expect(await claimBudgetSync(workspaceId)).toBeNull();
  expect(
    await database.transaction((transaction) => requestBudgetSync(transaction, workspaceId)),
  ).toBe(true);
  const first = await claimBudgetSync(workspaceId);
  if (!first) throw new Error('expected a budget lease');
  expect(await claimBudgetSync(workspaceId)).toBeNull();
  await database.transaction((transaction) => requestBudgetSync(transaction, workspaceId));
  expect(await finishBudgetSync({ workspaceId, ...first, failed: false })).toBe(true);
  const next = await claimBudgetSync(workspaceId);
  if (!next) throw new Error('expected the pending second request');
  expect(await renewBudgetSyncLease(workspaceId, first.token)).toBe(false);
  expect(await finishBudgetSync({ workspaceId, ...first, failed: false })).toBe(false);
  expect(await finishBudgetSync({ workspaceId, ...next, failed: false })).toBe(true);
  expect(await claimBudgetSync(workspaceId)).toBeNull();
});

test('an abandoned or failed chat cap raise is retried', async () => {
  await database.transaction((transaction) => requestBudgetSync(transaction, workspaceId));
  const abandoned = await claimBudgetSync(workspaceId);
  if (!abandoned) throw new Error('expected a budget lease');
  await database
    .update(workspace)
    .set({ budgetSyncLeaseUntil: new Date(0) })
    .where(eq(workspace.id, workspaceId));
  const retry = await claimBudgetSync(workspaceId);
  if (!retry) throw new Error('expected an expired lease to recover');
  expect(retry.token).not.toBe(abandoned.token);
  expect(await finishBudgetSync({ workspaceId, ...abandoned, failed: false })).toBe(false);
  expect(await finishBudgetSync({ workspaceId, ...retry, failed: true })).toBe(true);
  expect(await claimBudgetSync(workspaceId)).not.toBeNull();
});

test('auto top-up settings saved after the plan ended cannot switch charging back on', async () => {
  await database.transaction((transaction) =>
    applyPlanEntitlement(transaction, {
      workspaceId,
      subscriptionId: 'sub_policy',
      grant,
      resetAt: new Date(),
    }),
  );
  const settings = { enabled: true, thresholdCredits: 20, credits: 1000, monthlyCapDollars: 100 };
  expect((await persistAutoTopupSettings(workspaceId, settings)).kind).toBe('moved');
  await database.transaction((transaction) =>
    endPlanEntitlement(transaction, workspaceId, 'sub_policy'),
  );
  expect((await persistAutoTopupSettings(workspaceId, settings)).kind).toBe('refused');
  const current = (await database.select().from(workspace).where(eq(workspace.id, workspaceId))).at(
    0,
  );
  expect(current?.autoTopupEnabled).toBe(false);
});

test('a deleted workspace cannot be given new credits', async () => {
  await database
    .update(workspace)
    .set({ deletedAt: new Date(), lifecycleStatus: 'deleted' })
    .where(eq(workspace.id, workspaceId));
  expect(
    await database.transaction((transaction) => lockLiveLedger(transaction, workspaceId)),
  ).toBeUndefined();
  expect(
    await database.select().from(creditGrant).where(eq(creditGrant.workspaceId, workspaceId)),
  ).toEqual([]);
});

test('the receipt sweep keeps the newest Stripe receipt and unfinished deliveries, so neither is reprocessed', async () => {
  const old = new Date(Date.now() - 200 * 86400000);
  const receipt = (
    provider: 'stripe' | 'composio' | 'anthropic',
    eventId: string,
    state?: string,
  ) => ({
    provider,
    eventId,
    eventType: 'event',
    payload: state ? { state, taskId: 'task' } : null,
    processedAt: old,
  });
  await database
    .insert(processedWebhookEvent)
    .values([
      receipt('stripe', 'evt_old'),
      { ...receipt('stripe', 'evt_older'), processedAt: new Date(old.getTime() - 86400000) },
      receipt('anthropic', 'sevt_old'),
      receipt('composio', 'delivery_done', 'completed'),
      receipt('composio', 'delivery_skipped', 'skipped'),
      receipt('composio', 'delivery_open', 'ambiguous'),
      { ...receipt('anthropic', 'sevt_new'), processedAt: new Date() },
    ]);
  expect(await pruneWebhookReceipts()).toBe(4);
  const kept = await database
    .select({ eventId: processedWebhookEvent.eventId })
    .from(processedWebhookEvent)
    .orderBy(processedWebhookEvent.eventId);
  expect(kept.map((row) => row.eventId)).toEqual(['delivery_open', 'evt_old', 'sevt_new']);
  await database
    .insert(processedWebhookEvent)
    .values({ provider: 'stripe', eventId: 'evt_new', eventType: 'invoice.paid' });
  expect(await pruneWebhookReceipts()).toBe(1);
});

describe('welcome credits are once per person', () => {
  async function newWorkspace(): Promise<string> {
    const organizationId = `org-${randomUUID()}`;
    await seedOrganization(database, organizationId);
    const id = randomUUID();
    await database.insert(workspace).values({ id, organizationId, name: 'Welcome' });
    return id;
  }

  test('a person who loses a workspace and gets a new one is not welcomed again', async () => {
    await seedUser(database, 'returning');
    const first = await newWorkspace();
    const second = await newWorkspace();
    const welcome = (id: string) =>
      database.transaction((tx) =>
        grantWelcomeCredits(tx, { workspaceId: id, userId: 'returning' }),
      );
    expect(await welcome(first)).toBe(true);
    expect(await welcome(second)).toBe(false);
    expect(await getLiveCreditBalance(first)).toBe(100);
    expect(await getLiveCreditBalance(second)).toBe(0);
  });

  test('two concurrent workspace creations for one person welcome once', async () => {
    await seedUser(database, 'racer');
    const [a, b] = [await newWorkspace(), await newWorkspace()];
    const results = await Promise.all(
      [a, b].map((id) =>
        database.transaction((tx) => grantWelcomeCredits(tx, { workspaceId: id, userId: 'racer' })),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await getLiveCreditBalance(a)) + (await getLiveCreditBalance(b))).toBe(100);
  });
});
