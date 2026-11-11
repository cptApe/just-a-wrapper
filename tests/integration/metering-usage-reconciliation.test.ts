// Reconciling provider usage snapshots with the charges already made, and the sweeps that finish them.
import { randomUUID } from 'node:crypto';
import { NotFoundError } from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { creditBalanceProjection, seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const provider = vi.hoisted(() => ({ retrieve: vi.fn(), send: vi.fn(), list: vi.fn() }));
vi.mock('next/server', () => ({ after: () => {} }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/lib/observability', async (original) => ({
  ...(await original<typeof import('@/lib/observability')>()),
  captureException: vi.fn(),
}));
vi.mock('@/features/agents/api/anthropic-client', () => {
  const client = () => ({
    beta: {
      sessions: {
        retrieve: provider.retrieve,
        events: { send: provider.send, list: provider.list },
      },
      files: { list: () => ({ async *[Symbol.asyncIterator]() {} }) },
    },
  });
  return { getAnthropicClient: client, requireAnthropicClient: client };
});

const { accrueModelRequest } = await import('@/features/billing/api/accrue-model-request');
const { accrueSessionEnd } = await import('@/features/billing/api/accrue-session-end');
const { accrueVoiceTranscription } = await import('@/features/billing/api/accrue-voice');
const { accrueUsageReconciliation } = await import(
  '@/features/billing/api/accrue-usage-reconciliation'
);
const { reconcilePendingBilling } = await import(
  '@/features/billing/api/reconcile-pending-billing'
);
const { reconcileSessionUsage } = await import('@/features/billing/api/reconcile-session-usage');
const { creditsForVendorCents } = await import('@/features/billing/lib/credit-math');
const { runBillingRecovery } = await import('@/features/jobs/api/billing-recovery');
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_reconcile_usage';
const USER = 'user_reconcile_usage';
const NO_TOKENS = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
const USAGE_120_CREDITS = {
  inputTokens: 100_000,
  outputTokens: 100_000,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};
// 5k in and 200 out on Balanced: 1.2 cents.
const TINY = { inputTokens: 5_000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 0 };

let workspaceId: string;

beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  provider.retrieve.mockReset().mockResolvedValue({ usage: { active_seconds: 0 } });
  provider.send.mockReset().mockResolvedValue(undefined);
  provider.list.mockReset().mockResolvedValue([]);
  await seedOrganization(db, ORG);
  await seedUser(db, USER);
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('metering-owner', ${ORG}, ${USER}, 'owner', now())`);
  workspaceId = randomUUID();
  await db.execute(sql`insert into workspace (id, organization_id, name)
    values (${workspaceId}, ${ORG}, 'Reconcile')`);
  await seedCreditBalance(db, workspaceId, 1000);
});

const inContext = <T>(run: () => Promise<T>) =>
  withRequestContext({ route: 'test/reconcile' }, run);

async function seedSession(
  anthropicSessionId: string,
  tier: 'fast' | 'default' = 'default',
): Promise<string> {
  const id = randomUUID();
  await db.execute(
    sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id)
        values ('read_write', ${id}, ${workspaceId}, ${tier}, ${USER}, 'chat', 'running', ${anthropicSessionId})`,
  );
  return id;
}

async function balance(): Promise<number> {
  const { rows } = await db.execute<{ credit_balance: number }>(
    sql`select ${creditBalanceProjection} from workspace where id = ${workspaceId}`,
  );
  return requiredRow(rows.at(0)).credit_balance;
}

async function sessionTotals(sessionRowId: string) {
  const { rows } = await db.execute<{
    credits_consumed: number;
    vendor_cost_cents: number;
    charged: number;
  }>(
    sql`select s.credits_consumed, s.vendor_cost_cents::float8 as vendor_cost_cents,
               coalesce(sum(-u.credits_delta), 0)::int as charged
          from session s left join usage_event u on u.session_id = s.id
         where s.id = ${sessionRowId} group by s.id`,
  );
  return requiredRow(rows.at(0));
}

async function usageRows(sessionRowId: string) {
  const { rows } = await db.execute<{
    usage_key: string;
    credits_delta: number;
    tokens_in: number;
    tokens_out: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  }>(
    sql`select usage_key, credits_delta, tokens_in, tokens_out, cache_creation_tokens, cache_read_tokens
          from usage_event where session_id = ${sessionRowId} order by created_at`,
  );
  return rows;
}

function span(anthropicSessionId: string, anthropicEventId: string, usage = USAGE_120_CREDITS) {
  return accrueModelRequest({ anthropicSessionId, anthropicEventId, usage });
}

function snapshot(
  anthropicSessionId: string,
  anthropicEventId: string,
  usage: typeof NO_TOKENS,
  listCostMinorUnits: number | null,
  activeSeconds = 0,
) {
  return accrueUsageReconciliation({
    anthropicSessionId,
    anthropicEventId,
    snapshot: usage,
    listCostMinorUnits,
    activeSeconds,
  });
}

describe('a usage snapshot against the spans already charged', () => {
  test('a snapshot adds one replay-safe row for exactly the tokens the spans missed', async () => {
    const rowId = await seedSession('asess_reconcile');
    await span('asess_reconcile', 'sevt_span', {
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationTokens: 0,
      cacheReadTokens: 5,
    });
    const usage = {
      inputTokens: 150,
      outputTokens: 35,
      cacheCreationTokens: 7,
      cacheReadTokens: 5,
    };

    expect((await snapshot('asess_reconcile', 'sevt_snapshot', usage, null)).billed).toBe(true);
    expect((await snapshot('asess_reconcile', 'sevt_snapshot', usage, null)).billed).toBe(false);

    expect(await usageRows(rowId)).toMatchObject([
      {
        usage_key: 'sevt_span',
        tokens_in: 100,
        tokens_out: 20,
        cache_creation_tokens: 0,
        cache_read_tokens: 5,
      },
      {
        usage_key: 'sevt_snapshot',
        tokens_in: 50,
        tokens_out: 15,
        cache_creation_tokens: 7,
        cache_read_tokens: 0,
      },
    ]);
  });

  test('a Fast session that used the Expert helper is topped up to the provider list cost', async () => {
    const rowId = await seedSession('asess_expert_helper', 'fast');
    const million = { ...NO_TOKENS, inputTokens: 1_000_000 };
    await span('asess_expert_helper', 'sevt_span', million);
    // A span row stamped later than the snapshot's observation must not block the top-up.
    await db.execute(
      sql`update usage_event set created_at = now() + interval '1 hour' where usage_key = 'sevt_span'`,
    );

    // Opus input is $4/MTok, reported in minor USD units: a cumulative 400 cents.
    const result = await snapshot('asess_expert_helper', 'sevt_snapshot', million, 400);

    // The span charged 50 credits at the Fast rate; 400 were due, so the snapshot charges 350.
    expect(result).toMatchObject({ billed: true, credits: 350, balance: 600 });
    expect(await sessionTotals(rowId)).toMatchObject({
      credits_consumed: 400,
      vendor_cost_cents: 400,
    });
  });

  test('missing token counts are recorded even when the list cost needs no further credits', async () => {
    const rowId = await seedSession('asess_zero_credit');
    await span('asess_zero_credit', 'sevt_span', { ...NO_TOKENS, inputTokens: 100 });

    const result = await snapshot(
      'asess_zero_credit',
      'sevt_snapshot',
      { ...NO_TOKENS, inputTokens: 150 },
      1,
    );

    expect(result).toMatchObject({ billed: true, credits: 0 });
    expect(await sessionTotals(rowId)).toMatchObject({ vendor_cost_cents: 1, credits_consumed: 1 });
    expect(await usageRows(rowId)).toContainEqual(
      expect.objectContaining({ usage_key: 'sevt_snapshot', credits_delta: 0, tokens_in: 50 }),
    );
  });

  test('the list cost is net of runtime already billed for the session', async () => {
    const rowId = await seedSession('asess_platform_costs');
    provider.retrieve.mockResolvedValue({ usage: { active_seconds: 3600 } });
    await accrueSessionEnd('asess_platform_costs', {
      runtime: { kind: 'fetch' },
      anthropicEventId: 'sevt_runtime',
    });

    // 15 cents in all; eight runtime credits were already charged.
    expect(await snapshot('asess_platform_costs', 'sevt_snapshot', NO_TOKENS, 15)).toMatchObject({
      billed: true,
      credits: 7,
    });
    expect(await sessionTotals(rowId)).toMatchObject({ credits_consumed: 15 });
  });

  test('runtime reported after a snapshot that already covered it is not charged twice', async () => {
    await seedSession('snapshot-first');
    provider.retrieve.mockResolvedValue({ usage: { active_seconds: 3600 } });
    await inContext(async () => {
      await snapshot('snapshot-first', 'snapshot-usage', NO_TOKENS, 8, 3600);
      await accrueSessionEnd('snapshot-first', {
        runtime: { kind: 'fetch' },
        anthropicEventId: 'later-idle',
      });
    });
    expect(await balance()).toBe(992);
  });

  test('a provider snapshot only moves the session total by the cost not yet recorded', async () => {
    const rowId = await seedSession('snapshot-total');
    await inContext(async () => {
      await span('snapshot-total', 'tiny-span', TINY);
      // The provider reports 2 cents in all, including server tools the span did not carry.
      await snapshot('snapshot-total', 'snapshot-2c', TINY, 2);
    });
    const totals = await sessionTotals(rowId);
    expect(totals).toMatchObject({ credits_consumed: 2, vendor_cost_cents: 2, charged: 2 });
  });

  test('cumulative token sums beyond the Postgres integer range do not overflow into a charge', async () => {
    const rowId = await seedSession('asess_bigint');
    await db.execute(
      sql`insert into usage_event (workspace_id, session_id, event_type, tokens_in, tokens_out, credits_delta, usage_key)
          values (${workspaceId}, ${rowId}, 'model_request', 2000000000, 0, 0, 'sevt_large_a'),
                 (${workspaceId}, ${rowId}, 'model_request', 2000000000, 0, 0, 'sevt_large_b')`,
    );

    const result = await snapshot(
      'asess_bigint',
      'sevt_large_snapshot',
      { ...NO_TOKENS, inputTokens: 4_000_000_000 },
      null,
    );

    expect(result.billed).toBe(false);
    expect(await usageRows(rowId)).toHaveLength(2);
  });
});

describe('a span that arrives after or alongside its snapshot', () => {
  test('a delayed span already covered by a snapshot adds no credits and no tokens', async () => {
    await seedSession('delayed-span');
    await inContext(async () => {
      await snapshot('delayed-span', 'filled-snapshot', USAGE_120_CREDITS, 120);
      const before = await balance();
      await span('delayed-span', 'late-span');
      expect(await balance()).toBe(before);
    });
    const { rows } = await db.execute(
      sql`select credits_delta, tokens_in from usage_event where usage_key = 'late-span'`,
    );
    expect(rows[0]).toMatchObject({ credits_delta: 0, tokens_in: 0 });
  });

  test('a delayed span larger than the snapshot is charged the difference, once', async () => {
    await seedSession('partial-snapshot');
    await inContext(async () => {
      await snapshot(
        'partial-snapshot',
        'partial-snapshot-event',
        { ...NO_TOKENS, inputTokens: 50_000, outputTokens: 50_000 },
        60,
      );
      await span('partial-snapshot', 'late-larger-span');
      await span('partial-snapshot', 'late-larger-span');
    });
    expect(await balance()).toBe(880);
  });

  test('a span and a snapshot of the same tokens racing each other charge them once', async () => {
    const rowId = await seedSession('race-snapshot');
    await inContext(() =>
      Promise.all([
        span('race-snapshot', 'span'),
        snapshot('race-snapshot', 'snapshot', USAGE_120_CREDITS, 120),
      ]),
    );
    const totals = await sessionTotals(rowId);
    expect(totals).toMatchObject({ credits_consumed: 120, vendor_cost_cents: 120, charged: 120 });
    expect(totals.credits_consumed).toBe(creditsForVendorCents(totals.vendor_cost_cents));
  });
});

describe('finishing interrupted settlement', () => {
  test('replaying an event whose settlement was interrupted completes it without charging again', async () => {
    await seedSession('asess_recover');
    await span('asess_recover', 'evt_recover');
    const charged = await balance();
    await db.execute(
      sql`update usage_event set settlement_status = 'pending' where usage_key = 'evt_recover'`,
    );

    await span('asess_recover', 'evt_recover');

    expect(await balance()).toBe(charged);
    const { rows } = await db.execute(
      sql`select settlement_status from usage_event where usage_key = 'evt_recover'`,
    );
    expect(rows).toEqual([{ settlement_status: 'complete' }]);
  });

  test('a dictation charge whose settlement crashed is finished by the sweep, not charged again', async () => {
    await inContext(() =>
      accrueVoiceTranscription({
        requestId: 'crashed',
        workspaceId,
        organizationId: ORG,
        userId: USER,
        audioSeconds: 30,
        vendorCostCents: 0.4,
      }),
    );
    await db.execute(
      sql`update usage_event set settlement_status = 'pending' where usage_key = 'voice:crashed'`,
    );

    await inContext(() => reconcilePendingBilling({ reconcileToolDeliveries: async () => {} }));

    const { rows } = await db.execute(
      sql`select settlement_status, credits_delta from usage_event where usage_key = 'voice:crashed'`,
    );
    expect(rows).toEqual([{ settlement_status: 'complete', credits_delta: -1 }]);
    expect(await balance()).toBe(999);
  });
});

describe('the usage replay sweep', () => {
  test('a replay resumes from its saved cursor with overlap and skips sessions this app does not know', async () => {
    const id = await seedSession('cursor-session');
    await db.execute(
      sql`update session set usage_reconciled_at = ${new Date('2026-11-01T00:00:00Z')} where id = ${id}`,
    );

    await inContext(() => reconcileSessionUsage('cursor-session', Date.now() + 180_000));
    // Events stamped just before the cursor are read again, so a late-committed span is not missed.
    expect(provider.list).toHaveBeenCalledWith(
      'cursor-session',
      expect.objectContaining({ 'created_at[gt]': '2026-10-31T23:59:00.000Z' }),
      expect.anything(),
    );

    provider.list.mockClear();
    await reconcileSessionUsage('absent-session', Date.now() + 180_000);
    expect(provider.list).not.toHaveBeenCalled();
  });

  test('a session deleted upstream is marked reconciled instead of being retried forever', async () => {
    const id = await seedSession('deleted-upstream');
    provider.list.mockRejectedValueOnce(
      new NotFoundError(404, undefined, 'Deleted', new Headers()),
    );

    await inContext(() => reconcileSessionUsage('deleted-upstream', Date.now() + 180_000));

    const { rows } = await db.execute(
      sql`select usage_reconciled_at from session where id = ${id}`,
    );
    expect(rows[0]?.usage_reconciled_at).not.toBeNull();
  });

  test('the daily billing recovery reaches every eligible session, not only the first batch', async () => {
    for (let index = 0; index < 27; index++) await seedSession(`sweep-${index}`);

    await inContext(() => runBillingRecovery());

    const { rows } = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from session
          where workspace_id = ${workspaceId} and usage_reconciled_at is not null`,
    );
    expect(rows[0]?.total).toBe(27);
  });
});
