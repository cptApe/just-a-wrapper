// Metering of model tokens, container runtime and sessionless usage into charges, on real Postgres.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { creditBalanceProjection, seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const provider = vi.hoisted(() => ({
  retrieve: vi.fn(),
  send: vi.fn(),
  list: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('next/server', () => ({ after: () => {} }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/lib/observability', async (original) => ({
  ...(await original<typeof import('@/lib/observability')>()),
  captureException: provider.capture,
}));
vi.mock('@/features/agents/api/anthropic-client', () => {
  const client = () => ({
    beta: {
      sessions: {
        retrieve: provider.retrieve,
        events: { send: provider.send, list: provider.list },
      },
      // The artifact sweep on the idle path lists session outputs; this session produced none.
      files: { list: () => ({ async *[Symbol.asyncIterator]() {} }) },
    },
  });
  return { getAnthropicClient: client, requireAnthropicClient: client };
});

const { accrueModelRequest } = await import('@/features/billing/api/accrue-model-request');
const { accrueSessionEnd } = await import('@/features/billing/api/accrue-session-end');
const { accrueToolCall } = await import('@/features/billing/api/accrue-tool-call');
const { accrueTitleGeneration } = await import('@/features/billing/api/accrue-title-generation');
const { accrueVoiceTranscription } = await import('@/features/billing/api/accrue-voice');
const { accrueUsageReconciliation } = await import(
  '@/features/billing/api/accrue-usage-reconciliation'
);
const { creditsForVendorCents, TIER_CREDIT_MULTIPLIER } = await import(
  '@/features/billing/lib/credit-math'
);
const { createBackgroundWork } = await import('@/features/sessions/api/create-background-work');
const { hideSession } = await import('@/features/sessions/api/update-session');
const { routeAnthropicEvent } = await import('@/features/webhooks/anthropic');
const { withRequestContext, snapshotCtx } = await import('@/lib/request-context');

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_metering';
const USER = 'user_metering';
type Tier = 'fast' | 'default' | 'pro';

// 100k in and 100k out on Balanced ($2/$10 per MTok) is $1.20, so 120 credits at a cent each.
const USAGE_120_CREDITS = {
  inputTokens: 100_000,
  outputTokens: 100_000,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};
// 5k in and 200 out: 0.06 cents on Fast, 1.2 cents on Balanced and 2.4 cents on Expert.
const TINY = { inputTokens: 5_000, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 0 };
// One hour of container runtime is $0.08, so 8 credits.
const HOUR_SECONDS = 3600;

let workspaceId: string;

beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  provider.retrieve.mockReset().mockResolvedValue({ usage: { active_seconds: 0 } });
  provider.send.mockReset().mockResolvedValue(undefined);
  provider.list.mockReset().mockResolvedValue([]);
  provider.capture.mockReset();
  await seedOrganization(db, ORG);
  await seedUser(db, USER);
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('metering-owner', ${ORG}, ${USER}, 'owner', now())`);
  workspaceId = randomUUID();
  await db.execute(sql`insert into workspace (id, organization_id, name)
    values (${workspaceId}, ${ORG}, 'Metering')`);
});

const inContext = <T>(run: () => Promise<T>) => withRequestContext({ route: 'test/metering' }, run);

async function seedSession(
  anthropicSessionId: string,
  opts: { tier?: Tier; status?: string; containerSeconds?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await db.execute(
    sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status,
                             anthropic_session_id, container_seconds)
        values ('read_write', ${id}, ${workspaceId}, ${opts.tier ?? 'default'}, ${USER}, 'chat',
                ${opts.status ?? 'running'}, ${anthropicSessionId}, ${opts.containerSeconds ?? 0})`,
  );
  return id;
}

async function balance(): Promise<number> {
  const { rows } = await db.execute<{ credit_balance: number }>(
    sql`select ${creditBalanceProjection} from workspace where id = ${workspaceId}`,
  );
  return requiredRow(rows.at(0)).credit_balance;
}

async function usageEvents() {
  const { rows } = await db.execute<{
    event_type: string;
    credits_delta: number;
    usage_key: string | null;
    container_seconds: number | null;
    tokens_in: number | null;
  }>(
    sql`select event_type, credits_delta, usage_key, container_seconds, tokens_in
        from usage_event where workspace_id = ${workspaceId} order by created_at`,
  );
  return rows;
}

async function totals(sessionRowId: string) {
  const { rows } = await db.execute<{
    status: string;
    credits_consumed: number;
    vendor_cost_cents: number;
    container_seconds: number;
    charged: number;
    recorded_cents: number;
    rows: number;
  }>(
    sql`select s.status, s.credits_consumed, s.vendor_cost_cents::float8 as vendor_cost_cents,
               s.container_seconds,
               coalesce(sum(-u.credits_delta), 0)::int as charged,
               coalesce(sum(u.vendor_cost_cents) filter (where not u.platform_paid), 0)::float8 as recorded_cents,
               count(u.id)::int as rows
          from session s left join usage_event u on u.session_id = s.id
         where s.id = ${sessionRowId}
         group by s.id`,
  );
  return requiredRow(rows.at(0));
}

// Every accrual leaves the session total charged once, as whole credits of its exact vendor cost.
async function expectSettledTotals(sessionRowId: string) {
  const row = await totals(sessionRowId);
  expect(row.credits_consumed).toBe(creditsForVendorCents(row.vendor_cost_cents));
  expect(row.charged).toBe(row.credits_consumed);
  expect(row.recorded_cents).toBeCloseTo(row.vendor_cost_cents, 6);
  return row;
}

function fetchRuntime(anthropicSessionId: string, anthropicEventId: string) {
  return accrueSessionEnd(anthropicSessionId, { runtime: { kind: 'fetch' }, anthropicEventId });
}

function webhookEvent(type: string, sessionId: string, eventId: string) {
  return {
    id: eventId,
    created_at: '2026-06-11T00:00:00Z',
    type: 'event' as const,
    data: { type, id: sessionId, organization_id: ORG, workspace_id: 'wsp_anthropic' },
  };
}

describe('model tokens', () => {
  test('a model request charges its tokens once, writes one usage row and bumps the session total', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    const sessionRowId = await seedSession('asess_tokens');
    const input = {
      anthropicSessionId: 'asess_tokens',
      anthropicEventId: 'sevt_tokens',
      usage: USAGE_120_CREDITS,
    };

    expect(await accrueModelRequest(input)).toMatchObject({
      billed: true,
      credits: 120,
      balance: 880,
      paused: false,
    });
    // A second tab or a reconnect replays the same event id.
    expect(await accrueModelRequest(input)).toMatchObject({ billed: false });

    expect(await balance()).toBe(880);
    expect(await usageEvents()).toEqual([
      expect.objectContaining({
        event_type: 'model_request',
        credits_delta: -120,
        usage_key: 'sevt_tokens',
        tokens_in: 100_000,
      }),
    ]);
    expect(await totals(sessionRowId)).toMatchObject({
      credits_consumed: 120,
      vendor_cost_cents: 120,
      status: 'running',
    });
  });

  test('an errored request with zero usage is recorded and charges nothing', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    await seedSession('asess_zero');

    const result = await accrueModelRequest({
      anthropicSessionId: 'asess_zero',
      anthropicEventId: 'sevt_zero',
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });

    expect(result).toMatchObject({ billed: true, credits: 0 });
    expect(await balance()).toBe(100);
    expect(await usageEvents()).toMatchObject([{ usage_key: 'sevt_zero', credits_delta: 0 }]);
  });

  test('tier multipliers hold on a long run of tiny requests instead of rounding each one up', async () => {
    await seedCreditBalance(db, workspaceId, 100_000);
    async function run(tier: Tier): Promise<number> {
      const rowId = await seedSession(`tiny-${tier}`, { tier });
      for (let index = 0; index < 50; index += 1)
        await inContext(() =>
          accrueModelRequest({
            anthropicSessionId: `tiny-${tier}`,
            anthropicEventId: `${tier}-span-${index}`,
            usage: TINY,
          }),
        );
      return (await expectSettledTotals(rowId)).credits_consumed;
    }
    const balanced = await run('default');
    const fast = await run('fast');
    const expert = await run('pro');

    expect(balanced).toBe(60);
    // Rounded per request, Fast would cost 50 credits here instead of 3.
    expect(Math.abs(fast - TIER_CREDIT_MULTIPLIER.fast * balanced)).toBeLessThanOrEqual(1);
    expect(Math.abs(expert - TIER_CREDIT_MULTIPLIER.pro * balanced)).toBeLessThanOrEqual(1);
    expect(await balance()).toBe(100_000 - balanced - fast - expert);
  });

  test('concurrent duplicate deliveries of many spans charge every request exactly once', async () => {
    await seedCreditBalance(db, workspaceId, 100_000);
    const rowId = await seedSession('concurrent');
    const spans = Array.from({ length: 12 }, (_, index) => ({
      anthropicSessionId: 'concurrent',
      anthropicEventId: `concurrent-${index}`,
      usage: TINY,
    }));
    // Each span arrives twice at once, as a relay tab and the webhook replay would deliver it.
    await inContext(() =>
      Promise.all([...spans, ...spans].map((span) => accrueModelRequest(span))),
    );

    expect(await expectSettledTotals(rowId)).toMatchObject({
      rows: 12,
      vendor_cost_cents: 14.4,
      credits_consumed: 15,
    });
    const { rows } = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from model_usage_observation where session_id = ${rowId}`,
    );
    expect(requiredRow(rows.at(0)).count).toBe(12);
  });

  test('model, runtime and tool costs in one session are rounded once, not per event', async () => {
    await seedCreditBalance(db, workspaceId, 100_000);
    const rowId = await seedSession('mixed');
    // 0.6 cents of model, 45 seconds of runtime (0.1 cents) and a 0.3-cent tool call.
    await inContext(async () => {
      await accrueModelRequest({
        anthropicSessionId: 'mixed',
        anthropicEventId: 'm1',
        usage: { inputTokens: 3_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
      });
      await accrueSessionEnd('mixed', {
        anthropicEventId: 'idle-1',
        runtime: { kind: 'snapshot', activeSeconds: 45 },
      });
      await accrueToolCall({
        anthropicSessionId: 'mixed',
        toolUseId: 'toolu_small',
        toolName: 'web_search_exa',
        vendorCostCents: 0.3,
        source: 'tool_call',
      });
    });

    expect(await expectSettledTotals(rowId)).toMatchObject({
      credits_consumed: 1,
      vendor_cost_cents: 1,
      rows: 3,
    });
    expect(await balance()).toBe(100_000 - 1);
  });
});

describe('container runtime', () => {
  test('an idle bills the runtime delta: one hour at $0.08 is 8 credits', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    const rowId = await seedSession('asess_idle', { status: 'idle' });
    provider.retrieve.mockResolvedValue({ usage: { active_seconds: HOUR_SECONDS } });

    expect(await fetchRuntime('asess_idle', 'sevt_idle')).toMatchObject({
      billed: true,
      credits: 8,
      balance: 92,
    });
    expect((await totals(rowId)).container_seconds).toBe(HOUR_SECONDS);
    expect(await usageEvents()).toEqual([
      expect.objectContaining({
        event_type: 'container_runtime',
        credits_delta: -8,
        container_seconds: HOUR_SECONDS,
      }),
    ]);
  });

  test('the relay and the webhook reporting one idle under different event ids bill it once', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    await seedSession('asess_double', { status: 'idle' });
    provider.retrieve.mockResolvedValue({ usage: { active_seconds: HOUR_SECONDS } });

    expect((await fetchRuntime('asess_double', 'sevt_relay')).billed).toBe(true);
    expect((await fetchRuntime('asess_double', 'evt_webhook')).billed).toBe(false);
    expect(await balance()).toBe(92);
    expect(await usageEvents()).toHaveLength(1);
  });

  test('a replayed event id is not billed again even when the reported seconds grew', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    await seedSession('asess_unique', { status: 'idle' });
    provider.retrieve.mockResolvedValueOnce({ usage: { active_seconds: HOUR_SECONDS } });
    await fetchRuntime('asess_unique', 'sevt_same');
    provider.retrieve.mockResolvedValueOnce({ usage: { active_seconds: HOUR_SECONDS * 2 } });

    expect((await fetchRuntime('asess_unique', 'sevt_same')).billed).toBe(false);
    expect(await balance()).toBe(92);
  });

  test('a later idle bills only the runtime above what was already billed', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    await seedSession('asess_incr', { status: 'idle', containerSeconds: HOUR_SECONDS });
    provider.retrieve.mockResolvedValue({ usage: { active_seconds: HOUR_SECONDS * 2 } });

    // Two cumulative hours are 16 credits due, 8 of them already billed.
    expect(await fetchRuntime('asess_incr', 'sevt_incr')).toMatchObject({
      billed: true,
      credits: 8,
      balance: 92,
    });
  });

  test('many short idles add up to the exact runtime cost of the whole hour', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    const rowId = await seedSession('idles');
    await inContext(async () => {
      for (let seconds = 300; seconds <= 3600; seconds += 300)
        await accrueSessionEnd('idles', {
          anthropicEventId: `idle-${seconds}`,
          runtime: { kind: 'snapshot', activeSeconds: seconds },
        });
    });
    // Rounded per idle, twelve 0.67-cent idles would charge 12 credits.
    expect(await expectSettledTotals(rowId)).toMatchObject({ credits_consumed: 8, rows: 12 });
  });

  test('overlapping thread activity is billed as wall-clock runtime, not summed per thread', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    await seedSession('overlapping-threads');
    provider.retrieve.mockResolvedValue({
      usage: { active_seconds: HOUR_SECONDS },
      stats: { active_seconds: HOUR_SECONDS * 2 },
    });
    await inContext(() => fetchRuntime('overlapping-threads', 'runtime-overlap'));
    expect(await balance()).toBe(92);
  });

  test('runtime for a session this app does not know is skipped, never thrown back at the webhook', async () => {
    provider.retrieve.mockResolvedValue({ usage: { active_seconds: HOUR_SECONDS } });
    expect((await fetchRuntime('asess_never_seen', 'evt_unknown')).billed).toBe(false);
  });
});

describe('the Anthropic webhook', () => {
  test('session.status_idled bills the runtime the provider reports for the session', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    await seedSession('asess_hook', { status: 'idle' });
    provider.retrieve.mockResolvedValue({ usage: { active_seconds: HOUR_SECONDS } });

    await withRequestContext({ route: 'test-webhook' }, () =>
      routeAnthropicEvent(webhookEvent('session.status_idled', 'asess_hook', 'evt_hook_1')),
    );

    expect(await balance()).toBe(92);
    expect(await usageEvents()).toEqual([
      expect.objectContaining({
        event_type: 'container_runtime',
        usage_key: expect.stringContaining('runtime:asess_hook:'),
      }),
    ]);
  });

  test('a late idle webhook bills a hidden running session and does not reopen it', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    const id = await seedSession('hidden_idle');
    await hideSession({ sessionId: id, workspaceId });
    provider.list.mockResolvedValueOnce([
      {
        id: 'idle_hidden',
        type: 'session.status_idle',
        processed_at: new Date().toISOString(),
        stop_reason: { type: 'end_turn' },
      },
    ]);
    provider.retrieve.mockResolvedValue({ usage: { active_seconds: HOUR_SECONDS } });

    await withRequestContext({ route: 'test', feature: 'billing', op: 'test' }, () =>
      routeAnthropicEvent(
        webhookEvent('session.status_idled', 'hidden_idle', 'hidden_idle_webhook'),
      ),
    );

    expect(await balance()).toBe(92);
    expect((await totals(id)).status).toBe('terminated');
  });

  test('model spans of a session nobody watched are billed once from a redelivered webhook', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    await seedSession('unwatched');
    provider.list.mockResolvedValue([
      {
        type: 'span.model_request_end',
        id: 'unwatched-span',
        model_usage: {
          input_tokens: 100_000,
          output_tokens: 100_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    ]);
    const event = webhookEvent('session.status_idled', 'unwatched', 'unwatched-webhook');

    await withRequestContext({ route: 'test' }, async () => {
      await routeAnthropicEvent(event);
      await routeAnthropicEvent(event);
    });

    expect(await balance()).toBe(880);
    expect((await usageEvents()).filter((row) => row.event_type === 'model_request')).toHaveLength(
      1,
    );
  });
});

describe('usage outside a chat turn', () => {
  test('dictation is charged once per request at its rounded cost and records its audio length', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    const input = {
      requestId: 'voice-test',
      workspaceId,
      organizationId: ORG,
      userId: USER,
      audioSeconds: 1.4,
      vendorCostCents: 0.006,
    };

    await expect(accrueVoiceTranscription(input)).resolves.toMatchObject({
      billed: true,
      credits: 1,
      balance: 999,
    });
    // A retried request with the same key neither charges nor records again.
    await expect(accrueVoiceTranscription(input)).resolves.toMatchObject({ billed: false });
    expect(await balance()).toBe(999);
    const { rows } = await db.execute(
      sql`select usage_key, session_id, credits_delta, vendor_cost_cents::float8 as vendor_cost_cents,
                 audio_seconds, settlement_status, platform_paid
          from usage_event where workspace_id = ${workspaceId}`,
    );
    expect(rows).toEqual([
      {
        usage_key: 'voice:voice-test',
        session_id: null,
        credits_delta: -1,
        vendor_cost_cents: 0.006,
        audio_seconds: 2,
        settlement_status: 'complete',
        platform_paid: false,
      },
    ]);
  });

  test('chat title generation is recorded as platform cost and never charged to the customer', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    const rowId = await seedSession('titled');
    const input = {
      anthropicSessionId: 'titled',
      responseId: 'msg_title_1',
      pricingTier: 'fast' as const,
      usage: { inputTokens: 1_000, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0 },
    };
    await expect(inContext(() => accrueTitleGeneration(input))).resolves.toMatchObject({
      billed: true,
      credits: 0,
    });
    await expect(inContext(() => accrueTitleGeneration(input))).resolves.toMatchObject({
      billed: false,
    });

    const { rows } = await db.execute(
      sql`select event_type, credits_delta, platform_paid, vendor_cost_cents::float8 as vendor_cost_cents
            from usage_event where session_id = ${rowId}`,
    );
    expect(rows).toEqual([
      {
        event_type: 'title_generation',
        credits_delta: 0,
        platform_paid: true,
        vendor_cost_cents: 0.011,
      },
    ]);
    expect(await totals(rowId)).toMatchObject({ credits_consumed: 0, vendor_cost_cents: 0 });
    expect(await balance()).toBe(1000);
  });
});

describe('background accrual after a turn', () => {
  async function seedForBackground() {
    await seedCreditBalance(db, workspaceId, 10_000);
    return seedSession('sesn_ordered_accrual');
  }
  const reconcile = () =>
    accrueUsageReconciliation({
      anthropicSessionId: 'sesn_ordered_accrual',
      anthropicEventId: 'snapshot',
      activeSeconds: 0,
      snapshot: USAGE_120_CREDITS,
      listCostMinorUnits: null,
    });
  async function chargedCredits(sessionRowId: string) {
    const { rows } = await db.execute<{ credits: number }>(
      sql`select sum(-credits_delta)::int as credits from usage_event where session_id = ${sessionRowId}`,
    );
    return rows.at(0)?.credits;
  }

  test('a snapshot waits for the span before it, and turn analytics read the settled spend', async () => {
    const sessionRowId = await seedForBackground();
    await withRequestContext({ route: 'test/accrual' }, async () => {
      const work = createBackgroundWork(snapshotCtx(), 'sesn_ordered_accrual');
      const observed: string[] = [];
      let credits: number | undefined;
      work.run('accrue-model-request', async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        await accrueModelRequest({
          anthropicSessionId: 'sesn_ordered_accrual',
          anthropicEventId: 'span',
          usage: USAGE_120_CREDITS,
        });
        observed.push('span');
      });
      work.run('accrue-usage-reconciliation', async () => {
        await reconcile();
        observed.push('snapshot');
      });
      work.run('analytics-turn-complete', async () => {
        credits = await chargedCredits(sessionRowId);
        observed.push('analytics');
      });
      work.close();
      await work.settled();
      expect(observed).toEqual(['span', 'snapshot', 'analytics']);
      expect(credits).toBe(120);
    });
    expect(provider.capture).not.toHaveBeenCalled();
  });

  test('a failed earlier operation and failing telemetry do not skip the accrual that follows', async () => {
    const sessionRowId = await seedForBackground();
    provider.capture.mockImplementation(() => {
      throw new Error('Telemetry failed');
    });
    await withRequestContext({ route: 'test/accrual-failure' }, async () => {
      const work = createBackgroundWork(snapshotCtx(), 'sesn_ordered_accrual');
      work.run('accrue-model-request', () => {
        throw new Error('Earlier operation failed');
      });
      work.run('accrue-usage-reconciliation', reconcile);
      work.close();
      await work.settled();
    });
    expect(await chargedCredits(sessionRowId)).toBe(120);
    expect(provider.capture).toHaveBeenCalledTimes(1);
  });
});
