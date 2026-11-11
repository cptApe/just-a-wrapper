// A deployment without Stripe on real Postgres: no gate blocks a drained, planless workspace and usage is recorded as platform-paid.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, { STRIPE_SECRET_KEY: undefined }),
);
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/features/agents/api/anthropic-client', () => {
  const client = () => ({ beta: { sessions: { events: { send: vi.fn() } } } });
  return { getAnthropicClient: client, requireAnthropicClient: client };
});

const { accrueToolCall } = await import('@/features/billing/api/accrue-tool-call');
const { accrueVoiceTranscription } = await import('@/features/billing/api/accrue-voice');
const { accrueModelRequest } = await import('@/features/billing/api/accrue-model-request');
const { assertCanStartChat } = await import('@/features/billing/api/assert-plan-limits');
const { assertCanCreateScheduledTask } = await import('@/features/tasks/api/assert-schedule-limit');
const { requireSessionBudgetRefresh } = await import('@/features/billing/api/sync-session-budgets');
const { assertCanSpend } = await import('@/features/billing/api/spend-gate');
const { sessionBudgetForWorkspace } = await import('@/features/billing/api/session-budget');

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_billing_off';
const USER = 'user_billing_off';

async function seedDrainedWorkspace(): Promise<string> {
  const id = randomUUID();
  await db.execute(
    sql`insert into workspace (id, organization_id, name) values (${id}, ${ORG}, ${'Off WS'})`,
  );
  return id;
}

async function seedRunningSession(workspaceId: string, anthropicSessionId: string) {
  await db.execute(
    sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id)
        values ('read_write', ${randomUUID()}, ${workspaceId}, 'default', ${USER}, 'chat', 'running', ${anthropicSessionId})`,
  );
}

beforeAll(async () => {
  await applyMigrations(db);
});

beforeEach(async () => {
  await truncateAll(db);
  await seedUser(db, USER);
  await seedOrganization(db, ORG);
});

afterAll(async () => {
  await pool.end();
});

describe('billing off', () => {
  test('the spend gate never blocks a workspace with no credits and no plan', async () => {
    const workspaceId = await seedDrainedWorkspace();
    for (const credits of [0, 1_000_000])
      await expect(
        assertCanSpend({ entry: 'tool', workspaceId, userId: USER, credits }),
      ).resolves.toBeUndefined();
  });

  test('plan limits do not cap chats or scheduled tasks', async () => {
    const workspaceId = await seedDrainedWorkspace();
    await expect(
      db.transaction((tx) => assertCanStartChat(workspaceId, tx)),
    ).resolves.toBeUndefined();
    await expect(
      db.transaction((tx) => assertCanCreateScheduledTask(workspaceId, USER, tx)),
    ).resolves.toBeUndefined();
  });

  test('chats get no spending cap, so they never pause for credits', async () => {
    const workspaceId = await seedDrainedWorkspace();
    await seedRunningSession(workspaceId, 'asess_off_budget');
    await expect(sessionBudgetForWorkspace(workspaceId)).resolves.toBeUndefined();
    await expect(requireSessionBudgetRefresh(workspaceId, 'asess_off_budget')).resolves.toBe(true);
  });

  test('a tool call is recorded as platform-paid with no charge and no pause', async () => {
    const workspaceId = await seedDrainedWorkspace();
    await seedRunningSession(workspaceId, 'asess_off_meter');
    const result = await accrueToolCall({
      anthropicSessionId: 'asess_off_meter',
      toolUseId: 'toolu_off',
      toolName: 'web_search',
      vendorCostCents: 500,
      source: 'tool_call',
    });
    expect(result).toMatchObject({ billed: true, credits: 0, paused: false });
    const { rows: events } = await db.execute<{ credits_delta: number; platform_paid: boolean }>(
      sql`select credits_delta, platform_paid from usage_event where workspace_id = ${workspaceId}`,
    );
    expect(requiredRow(events.at(0))).toEqual({ credits_delta: 0, platform_paid: true });
    const { rows: grants } = await db.execute(
      sql`select id from credit_grant where workspace_id = ${workspaceId}`,
    );
    expect(grants).toHaveLength(0);
    const { rows: sessions } = await db.execute<{ status: string }>(
      sql`select status from session where anthropic_session_id = 'asess_off_meter'`,
    );
    expect(requiredRow(sessions.at(0)).status).toBe('running');
  });

  test('dictation is recorded at its exact vendor cost as platform-paid and charges nothing', async () => {
    const workspaceId = await seedDrainedWorkspace();
    const result = await accrueVoiceTranscription({
      workspaceId,
      organizationId: ORG,
      userId: USER,
      requestId: 'off-dictation',
      audioSeconds: 12,
      vendorCostCents: 0.133,
    });
    expect(result).toMatchObject({ billed: true, credits: 0, paused: false });
    const { rows } = await db.execute(
      sql`select event_type, credits_delta, platform_paid, settlement_status,
                 vendor_cost_cents::float8 as vendor_cost_cents, audio_seconds
            from usage_event where workspace_id = ${workspaceId}`,
    );
    expect(rows).toEqual([
      {
        event_type: 'voice_transcription',
        credits_delta: 0,
        platform_paid: true,
        settlement_status: 'complete',
        vendor_cost_cents: 0.133,
        audio_seconds: 12,
      },
    ]);
  });

  test('model usage paid by the platform stays out of the chat total the customer sees', async () => {
    const workspaceId = await seedDrainedWorkspace();
    await seedRunningSession(workspaceId, 'asess_off_total');
    await accrueModelRequest({
      anthropicSessionId: 'asess_off_total',
      anthropicEventId: 'off-span',
      usage: { inputTokens: 100_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    });
    const { rows } = await db.execute(
      sql`select s.credits_consumed, s.vendor_cost_cents::float8 as session_cents,
                 u.vendor_cost_cents::float8 as row_cents, u.platform_paid
            from session s join usage_event u on u.session_id = s.id
           where s.anthropic_session_id = 'asess_off_total'`,
    );
    expect(rows).toEqual([
      { credits_consumed: 0, session_cents: 0, row_cents: 20, platform_paid: true },
    ]);
  });
});
