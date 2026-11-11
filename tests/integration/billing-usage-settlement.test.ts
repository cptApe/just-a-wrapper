// Usage charges on real Postgres: voice and tool charges settle even when Stripe is down or the workspace row is locked.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { seedCreditBalance } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const network = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  listIntents: vi.fn(),
  retrieveIntent: vi.fn(),
  createIntent: vi.fn(),
}));
vi.mock('@/lib/stripe', () => {
  const boundary = {
    getStripe: () => ({
      subscriptions: { retrieve: network.retrieveSubscription },
      paymentIntents: {
        list: network.listIntents,
        retrieve: network.retrieveIntent,
        create: network.createIntent,
      },
    }),
    STRIPE_API_VERSION: '2026-05-27.dahlia',
  };
  return { ...boundary, requireStripe: boundary.getStripe };
});
vi.mock('next/server', () => ({ after: () => {} }));
const { accrueVoiceTranscription } = await import('@/features/billing/api/accrue-voice');
const { accrueVoiceSynthesis } = await import('@/features/billing/api/accrue-voice-synthesis');
const { reconcileToolDeliveries } = await import('@/features/tools/api/reconcile-tool-deliveries');
const { getLiveCreditBalance } = await import('@/features/billing/api/credit-ledger');
const { settleAccrual } = await import('@/features/billing/api/settle-accrual');
const { loadBillableSession } = await import('@/features/billing/api/load-billable-session');
const { withRequestContext } = await import('@/lib/request-context');
const pool = makeTestPool();
const database = makeTestDb(pool);
let workspaceId: string;
let sessionId: string;
beforeAll(() => applyMigrations(database));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(database);
  vi.resetAllMocks();
  network.retrieveSubscription.mockRejectedValue(new Error('Stripe unavailable'));
  await seedOrganization(database, 'safety');
  await seedUser(database, 'owner');
  workspaceId = randomUUID();
  sessionId = randomUUID();
  await database.execute(sql`insert into workspace (id, organization_id, name, plan_tier, stripe_customer_id, stripe_subscription_id, auto_topup_enabled, auto_topup_threshold_credits, auto_topup_credits, auto_topup_monthly_cap_cents, plan_billing_interval, plan_credits)
    values (${workspaceId}, 'safety', 'Safety', 'pro', 'cus_safety', 'sub_safety', true, 100, 1000, 100000, 'month', 1000)`);
  await seedCreditBalance(database, workspaceId, 100);
  await database.execute(sql`insert into session (id, workspace_id, created_by_user_id, tier, kind, status, anthropic_session_id, workspace_memory_access)
    values (${sessionId}, ${workspaceId}, 'owner', 'default', 'chat', 'idle', 'safety-session', 'none')`);
});
function context<T>(run: () => Promise<T>) {
  return withRequestContext({ route: 'test/billing-safety' }, run);
}

test('a Stripe outage during auto top-up still charges a dictation', async () => {
  await expect(
    context(() =>
      accrueVoiceTranscription({
        workspaceId,
        organizationId: 'safety',
        userId: 'owner',
        audioSeconds: 10,
        vendorCostCents: 1,
        requestId: 'transcript',
      }),
    ),
  ).resolves.toMatchObject({ credits: 1 });
  expect(network.retrieveSubscription).toHaveBeenCalled();
  expect(await getLiveCreditBalance(workspaceId)).toBe(99);
});

test('a Stripe outage during auto top-up still charges and settles read-aloud', async () => {
  await expect(
    context(() =>
      accrueVoiceSynthesis({
        anthropicSessionId: 'safety-session',
        requestId: 'speech',
        userId: 'owner',
        vendorCostCents: 1,
      }),
    ),
  ).resolves.toMatchObject({ billed: true });
  expect(network.retrieveSubscription).toHaveBeenCalled();
  const rows = await database.execute(
    sql`select settlement_status from usage_event where usage_key = 'tts:speech'`,
  );
  expect(rows.rows).toEqual([{ settlement_status: 'complete' }]);
  expect(await getLiveCreditBalance(workspaceId)).toBe(99);
});

// FOR KEY SHARE conflicts only with the auto top-up claim's FOR UPDATE, not with the charge's own locks.
async function whileWorkspaceRowLocked<T>(run: () => Promise<T>): Promise<T | 'blocked'> {
  const holder = await pool.connect();
  await holder.query('begin');
  await holder.query('select id from workspace where id = $1 for key share', [workspaceId]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<'blocked'>((resolve) => {
        timer = setTimeout(() => resolve('blocked'), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await holder.query('rollback');
    holder.release();
  }
}

function expectNoStripeCall() {
  for (const call of Object.values(network)) expect(call).not.toHaveBeenCalled();
}

test('with auto top-up off, a charge neither waits on the workspace row lock nor calls Stripe', async () => {
  await database.execute(
    sql`update workspace set auto_topup_enabled = false where id = ${workspaceId}`,
  );
  const target = await loadBillableSession('safety-session');
  if (!target) throw new Error('Expected billable session');
  const settled = await whileWorkspaceRowLocked(() =>
    context(() =>
      settleAccrual(target, 1, {
        eventId: 'disabled-settle',
        balance: 100,
        memberLimitExceeded: false,
      }),
    ),
  );
  expect(settled).toMatchObject({ billed: true, credits: 1 });
  const transcribed = await whileWorkspaceRowLocked(() =>
    context(() =>
      accrueVoiceTranscription({
        workspaceId,
        organizationId: 'safety',
        userId: 'owner',
        audioSeconds: 10,
        vendorCostCents: 1,
        requestId: 'disabled-transcript',
      }),
    ),
  );
  expect(transcribed).toMatchObject({ credits: 1 });
  expectNoStripeCall();
});

test('a charge that leaves the balance above the top-up threshold does not wait on the workspace row lock', async () => {
  await seedCreditBalance(database, workspaceId, 500);
  const target = await loadBillableSession('safety-session');
  if (!target) throw new Error('Expected billable session');
  const settled = await whileWorkspaceRowLocked(() =>
    context(() =>
      settleAccrual(target, 1, {
        eventId: 'above-threshold',
        balance: 500,
        memberLimitExceeded: false,
      }),
    ),
  );
  expect(settled).toMatchObject({ billed: true });
  expectNoStripeCall();
});

test('a tool result delivered after the browser left is charged once by the sweep', async () => {
  await database.execute(
    sql`update workspace set auto_topup_enabled = false where id = ${workspaceId}`,
  );
  const delivery = JSON.stringify({
    isError: false,
    source: 'tool_call',
    content: { done: true },
    vendorCostCents: 5,
  });
  await database.execute(sql`insert into custom_tool_dispatch (tool_use_id, session_id, tool_name, status, delivery, updated_at)
    values ('paid-tool', ${sessionId}, 'costed', 'delivered', ${delivery}::jsonb, now() - interval '1 day')`);
  await context(reconcileToolDeliveries);
  await context(reconcileToolDeliveries);
  expect(await getLiveCreditBalance(workspaceId)).toBe(95);
  const rows = await database.execute(
    sql`select status from custom_tool_dispatch where tool_use_id = 'paid-tool'`,
  );
  expect(rows.rows).toEqual([{ status: 'completed' }]);
});

test('the sweep does not settle a tool still waiting for the person to approve it', async () => {
  await database.execute(sql`insert into custom_tool_dispatch (tool_use_id, session_id, tool_name, status, updated_at)
    values ('pending-tool', ${sessionId}, 'costed', 'awaiting_decision', now() - interval '1 day')`);
  await database.execute(sql`insert into pending_confirmation (session_id, workspace_id, tool_use_id, tool_name, input)
    values (${sessionId}, ${workspaceId}, 'pending-tool', 'costed', '{}')`);
  await context(reconcileToolDeliveries);
  const rows = await database.execute(
    sql`select status from custom_tool_dispatch where tool_use_id = 'pending-tool'`,
  );
  expect(rows.rows).toEqual([{ status: 'awaiting_decision' }]);
});

test('read-aloud charges the member who asked, not the creator of the shared chat', async () => {
  await seedUser(database, 'reader');
  await database.execute(
    sql`update workspace set auto_topup_enabled = false where id = ${workspaceId}`,
  );
  await database.execute(sql`insert into workspace_member (organization_id, user_id, composio_user_id, credit_limit)
    values ('safety', 'reader', 'reader', 1), ('safety', 'owner', 'owner', 1)`);
  await context(() =>
    accrueVoiceSynthesis({
      anthropicSessionId: 'safety-session',
      requestId: 'shared-audio',
      userId: 'reader',
      vendorCostCents: 1,
    }),
  );
  const { checkSpend } = await import('@/features/billing/api/spend-gate');
  const gate = (userId: string) => checkSpend({ entry: 'read_aloud', workspaceId, userId });
  expect(await gate('reader')).toMatchObject({
    reason: 'member_limit',
    error: { code: 'CREDITS_EXHAUSTED' },
  });
  expect((await gate('owner'))?.reason).not.toBe('member_limit');
  const rows = await database.execute(
    sql`select user_id from usage_event where usage_key = 'tts:shared-audio'`,
  );
  expect(rows.rows).toEqual([{ user_id: 'reader' }]);
});

test('a serialization failure while charging read-aloud retries instead of losing the charge', async () => {
  await database.execute(
    sql`update workspace set auto_topup_enabled = false where id = ${workspaceId}`,
  );
  await database.execute(sql`create sequence tts_conflicts`);
  await database.execute(
    sql`create function conflict_once() returns trigger language plpgsql as $$ begin
      if nextval('tts_conflicts') = 1 then
        raise exception 'could not serialize access' using errcode = '40001';
      end if;
      return new;
    end $$`,
  );
  await database.execute(
    sql`create trigger conflict_once before insert on usage_event for each row execute function conflict_once()`,
  );
  try {
    await expect(
      context(() =>
        accrueVoiceSynthesis({
          anthropicSessionId: 'safety-session',
          requestId: 'contended',
          userId: 'owner',
          vendorCostCents: 1,
        }),
      ),
    ).resolves.toMatchObject({ billed: true, credits: 1 });
  } finally {
    await database.execute(sql`drop trigger conflict_once on usage_event`);
    await database.execute(sql`drop function conflict_once()`);
    await database.execute(sql`drop sequence tts_conflicts`);
  }
  expect(await getLiveCreditBalance(workspaceId)).toBe(99);
});

test('read-aloud for a chat this app does not know charges nothing and does not fail', async () => {
  await expect(
    context(() =>
      accrueVoiceSynthesis({
        anthropicSessionId: 'missing-session',
        requestId: 'orphan',
        userId: 'owner',
        vendorCostCents: 1,
      }),
    ),
  ).resolves.toMatchObject({ billed: false });
});
