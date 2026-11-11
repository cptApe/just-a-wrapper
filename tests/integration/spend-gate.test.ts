// The one spend gate on real Postgres: the balance floor, estimates, the member limit, and every paid entry point that runs it.
import { randomUUID } from 'node:crypto';
import { APIError } from '@anthropic-ai/sdk';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { seedCreditBalance } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const provider = vi.hoisted(() => {
  // Every paid provider is configured, so every paid tool is in the registry.
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
  process.env.EXA_API_KEY = 'test-exa-key';
  process.env.BROWSERBASE_API_KEY = 'test-browser-key';
  process.env.BROWSERBASE_PROJECT_ID = 'test-project';
  return { capture: vi.fn(), run: vi.fn(), deploymentRetrieve: vi.fn() };
});
vi.mock('next/server', () => ({ after: () => {} }));
vi.mock('@/lib/observability', async (original) => ({
  ...(await original<typeof import('@/lib/observability')>()),
  captureException: provider.capture,
}));
vi.mock('@/features/agents/api/anthropic-client', () => {
  const client = () => ({
    beta: {
      sessions: { events: { send: vi.fn(async () => {}) } },
      deployments: { run: provider.run, retrieve: provider.deploymentRetrieve },
    },
  });
  return { getAnthropicClient: client, requireAnthropicClient: client };
});

const { getMemberCycleUsage } = await import('@/features/billing/api/get-member-cycle-usage');
const { assertCanSpend, checkSpend } = await import('@/features/billing/api/spend-gate');
const { creditsForVendorCents } = await import('@/features/billing/lib/credit-math');
const { sessionRouteErrorResponse } = await import('@/features/sessions/api/session-access');
const { runTaskNow } = await import('@/features/tasks/api/task-lifecycle');
const { CUSTOM_TOOL_NAMES, isToolAvailable } = await import('@/features/tool-catalog/declarations');
const { GenerateImageInputSchema } = await import('@/features/tool-catalog/generate-image');
const { GenerateVideoInputSchema } = await import('@/features/tool-catalog/generate-video');
const { runAndPost } = await import('@/features/tools/api/dispatch-execution');
const { getCustomTool } = await import('@/features/tools/api/registry');
const { generateImageTool } = await import('@/features/tools/custom-tools/generate-image');
const { generateVideoTool } = await import('@/features/tools/custom-tools/generate-video');
const { bindTool } = await import('@/features/tools/lib/bind-tool');
const { anthropicEventPoster } = await import('@/features/sessions/api/anthropic-events');
const { synthesizeForReadAloud } = await import('@/features/voice/api/synthesize-for-read-aloud');
const { BillingError, ToolError } = await import('@/lib/errors');
const { withRequestContext } = await import('@/lib/request-context');
type CustomTool<I, O> = import('@/features/tool-catalog/types').CustomTool<I, O>;
type Capabilities = import('@/lib/capabilities').Capabilities;

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_gate';
const USER = 'user_gate';

type Posted = { sessionId: string; toolUseId: string; isError: boolean; content: unknown };
const posted = vi.fn<(args: Posted) => Promise<void>>(async () => {});

let workspaceId: string;

beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  vi.clearAllMocks();
  provider.deploymentRetrieve.mockResolvedValue({
    status: 'active',
    archived_at: null,
    schedule: null,
  });
  vi.spyOn(anthropicEventPoster, 'postCustomToolResult').mockImplementation(posted);
  vi.spyOn(anthropicEventPoster, 'isToolResultDelivered').mockResolvedValue(false);
  vi.spyOn(anthropicEventPoster, 'postToolConfirmation').mockResolvedValue(undefined);
  await seedUser(db, USER);
  await seedOrganization(db, ORG);
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('gate-owner', ${ORG}, ${USER}, 'owner', now())`);
  workspaceId = randomUUID();
  await db.execute(
    sql`insert into workspace (id, organization_id, name) values (${workspaceId}, ${ORG}, 'Gate')`,
  );
});
afterEach(() => {
  vi.useRealTimers();
});

async function putOnPro() {
  await db.execute(
    sql`update workspace set plan_tier = 'pro', stripe_subscription_id = 'sub_gate', plan_billing_interval = 'month', plan_credits = 1000 where id = ${workspaceId}`,
  );
}

// The member's allowance: `limit` credits this period, `used` of them spent.
async function limitMember(limit: number, used = 0) {
  await db.execute(sql`insert into workspace_member (organization_id, user_id, composio_user_id, credit_limit)
    values (${ORG}, ${USER}, 'gate-member', ${limit})`);
  if (used > 0) await spend(used);
}

async function spend(credits: number) {
  await db.execute(sql`insert into usage_event (workspace_id, user_id, event_type, credits_delta)
    values (${workspaceId}, ${USER}, 'tool_call', ${-credits})`);
}

async function balance(): Promise<number> {
  const { rows } = await db.execute<{ balance: number }>(
    sql`select coalesce(sum(amount - consumed), 0)::int as balance from credit_grant
        where workspace_id = ${workspaceId} and status = 'issued'`,
  );
  return rows.at(0)?.balance ?? 0;
}

const turn = () => ({ entry: 'send' as const, workspaceId, userId: USER });
const tool = (credits: number) => ({ entry: 'tool' as const, workspaceId, userId: USER, credits });

describe('the workspace balance', () => {
  test.each([0, -31])('a workspace with a balance of %i is refused a turn', async (credits) => {
    await seedCreditBalance(db, workspaceId, credits);
    const error = await assertCanSpend(turn()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BillingError);
    expect(error).toMatchObject({ code: 'CREDITS_EXHAUSTED', context: { reason: 'credits' } });
  });

  test('one credit is enough for a turn and for a tool whose estimate rounds to zero', async () => {
    await seedCreditBalance(db, workspaceId, 1);
    await expect(assertCanSpend(turn())).resolves.toBeUndefined();
    await expect(assertCanSpend(tool(0))).resolves.toBeUndefined();
  });

  test('an estimate needs its whole amount on hand, and passing the gate reserves nothing', async () => {
    await seedCreditBalance(db, workspaceId, 6);
    await expect(assertCanSpend(tool(6))).resolves.toBeUndefined();
    await expect(assertCanSpend(tool(6))).resolves.toBeUndefined();
    await expect(assertCanSpend(tool(7))).rejects.toMatchObject({
      code: 'CREDITS_EXHAUSTED',
      context: { reason: 'credits', available: 6, requiredCredits: 7, entry: 'tool' },
    });
  });

  test('a broken estimate fails closed instead of letting the spend through', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    for (const credits of [Number.NaN, Number.POSITIVE_INFINITY, -1])
      await expect(assertCanSpend(tool(credits))).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
  });

  test('the refusal reaches the session routes as a 402 the client treats as an expected state', async () => {
    const error = await assertCanSpend(turn()).then(
      () => null,
      (e: unknown) => e,
    );
    const res = sessionRouteErrorResponse(error);
    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: 'CREDITS_EXHAUSTED', expectedState: true },
    });
  });
});

describe('the member credit limit', () => {
  test('a member with one credit of allowance left may start a turn; at the limit they may not', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    await limitMember(100, 99);
    await expect(checkSpend(turn())).resolves.toBeNull();

    await spend(1);
    const refusal = await checkSpend(turn());
    expect(refusal?.reason).toBe('member_limit');
    expect(refusal?.error).toMatchObject({
      code: 'CREDITS_EXHAUSTED',
      context: { reason: 'member_limit', userId: USER, expectedState: true },
    });
  });

  test('an estimate larger than the remaining allowance is refused even when the workspace can pay', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    await limitMember(100, 96);
    await expect(checkSpend(tool(4))).resolves.toBeNull();
    expect((await checkSpend(tool(5)))?.error).toMatchObject({
      context: { reason: 'member_limit', available: 4, requiredCredits: 5 },
    });
  });

  test('a member without a limit is held only by the workspace balance', async () => {
    await seedCreditBalance(db, workspaceId, 3);
    expect((await checkSpend(tool(4)))?.reason).toBe('credits');
  });

  test('the billing period is read on the database clock, so a skewed app clock cannot reset the allowance', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    await limitMember(100, 100);
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(Date.now() + 366 * 24 * 3_600_000) });
    expect((await checkSpend(turn()))?.reason).toBe('member_limit');
    expect(await getMemberCycleUsage(ORG)).toEqual({ [USER]: 100 });
  });

  test('read aloud refuses a caller at their member limit before any audio is made', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    await putOnPro();
    await limitMember(0);
    await db.execute(sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id)
      values ('read_write', ${workspaceId}, 'default', ${USER}, 'chat', 'running', 'voice-limit')`);

    await expect(
      synthesizeForReadAloud({
        workspaceId,
        userId: USER,
        anthropicSessionId: 'voice-limit',
        text: 'Hello',
      }),
    ).rejects.toMatchObject({ code: 'CREDITS_EXHAUSTED', context: { reason: 'member_limit' } });
    const { rows } = await db.execute(
      sql`select 1 from usage_event where workspace_id = ${workspaceId}`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('the dispatcher gate for paid tools', () => {
  async function seedChat() {
    const sessionRowId = randomUUID();
    const anthropicSessionId = `asess_${sessionRowId}`;
    await db.execute(
      sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id)
          values ('read_write', ${sessionRowId}, ${workspaceId}, 'default', ${USER}, 'chat', 'running', ${anthropicSessionId})`,
    );
    return { workspaceId, sessionRowId, anthropicSessionId };
  }

  async function dispatch<I, O>(
    custom: CustomTool<I, O>,
    toolUseId: string,
    chat: Awaited<ReturnType<typeof seedChat>>,
  ) {
    await db.execute(
      sql`insert into custom_tool_dispatch (session_id, tool_use_id, tool_name) values (${chat.sessionRowId}, ${toolUseId}, ${custom.name})`,
    );
    const bound = bindTool(custom);
    const prepared = bound.prepare({});
    if (!prepared.success) throw prepared.error;
    return runAndPost(bound, prepared.data, toolUseId, {
      ...chat,
      userId: USER,
      actorUserId: USER,
    });
  }

  function freeTool(
    name: string,
    handler: () => Promise<{ ok: boolean }>,
  ): CustomTool<Record<string, unknown>, { ok: boolean }> {
    return {
      name,
      description: 'a stand-in tool',
      riskLevel: 'safe',
      inputJsonSchema: { type: 'object' },
      inputSchema: z.object({}).loose(),
      outputSchema: z.object({ ok: z.boolean() }),
      handler,
    };
  }
  // Priced like the real media tools: the stored quality setting raises the estimate.
  const pricedByQuality = (
    handler: () => Promise<{ ok: boolean }>,
  ): CustomTool<Record<string, unknown>, { ok: boolean }> => ({
    ...freeTool('generate_image', handler),
    measureVendorCostCents: () => 0,
    estimateCredits: (_input, settings) => (settings.defaultQuality === 'high' ? 50 : 2),
  });

  test('the real media tools estimate from the stored quality setting', () => {
    function estimate<I, O>(custom: CustomTool<I, O>, raw: unknown) {
      const prepared = bindTool(custom).prepare(raw);
      if (!prepared.success || !prepared.data.estimateCredits) throw new Error('no estimate');
      return prepared.data.estimateCredits;
    }
    const image = estimate(generateImageTool, GenerateImageInputSchema.parse({ prompt: 'a map' }));
    expect(image({})).toBe(creditsForVendorCents(15));
    expect(image({ defaultQuality: 'high' })).toBe(creditsForVendorCents(50));
    const video = estimate(
      generateVideoTool,
      GenerateVideoInputSchema.parse({ prompt: 'a map', duration: '8' }),
    );
    expect(video({ defaultQuality: 'high' })).toBe(creditsForVendorCents(68.2 * 8));
  });

  test('a member whose allowance cannot cover the stored-quality estimate is refused before the handler runs', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    await limitMember(10);
    const chat = await seedChat();
    const handler = vi.fn(async () => ({ ok: true }));

    await expect(dispatch(pricedByQuality(handler), 'toolu_ok', chat)).resolves.toMatchObject({
      isError: false,
    });
    await db.execute(sql`insert into tool_permission (organization_id, user_id, toolkit, tool_name, policy, settings)
      values (${ORG}, ${USER}, 'builtin', 'generate_image', 'allow', '{"defaultQuality":"high"}'::jsonb)`);
    await expect(dispatch(pricedByQuality(handler), 'toolu_refused', chat)).resolves.toMatchObject({
      status: 'posted',
      isError: true,
      detail: 'CREDITS_EXHAUSTED',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(posted.mock.calls.at(-1)?.[0].content).toMatchObject({ code: 'CREDITS_EXHAUSTED' });
    expect(await balance()).toBe(1000);
    expect(provider.capture).not.toHaveBeenCalled();
  });

  test('a tool with no estimate still runs at an empty balance', async () => {
    const chat = await seedChat();
    const handler = vi.fn(async () => ({ ok: true }));
    await expect(
      dispatch(freeTool('list_skills', handler), 'toolu_free', chat),
    ).resolves.toMatchObject({ isError: false });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('a bad tool input goes back to the agent without an incident; a handler crash is reported', async () => {
    await seedCreditBalance(db, workspaceId, 1000);
    const chat = await seedChat();
    const badInput = pricedByQuality(async () => {
      throw new ToolError('TOOL_INPUT_INVALID', 'Provide exactly one of cron or run_at.', {});
    });
    await expect(dispatch(badInput, 'toolu_bad_input', chat)).resolves.toMatchObject({
      isError: true,
      detail: 'TOOL_INPUT_INVALID',
    });
    expect(provider.capture).not.toHaveBeenCalled();

    const crash = pricedByQuality(async () => {
      throw new Error('handler bug');
    });
    await dispatch(crash, 'toolu_crash', chat);
    expect(provider.capture).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'handler bug' }),
      expect.objectContaining({ tool: 'generate_image' }),
    );
  });

  test('every custom tool that spends vendor money declares an estimate, and no free tool does', async () => {
    // With every paid provider off, a tool that disappears is one that spends vendor money.
    const paidProvidersOff = {
      media: { kind: 'off' },
      webSearch: { kind: 'anthropic' },
      browser: { kind: 'sandbox' },
    } as Pick<Capabilities, 'media' | 'webSearch' | 'browser'> as Capabilities;
    // Closing a browser ends spend; refusing it at an empty balance would keep the browser billing.
    const freeVendorTools = new Set(['browse_close']);
    for (const name of CUSTOM_TOOL_NAMES) {
      const custom = await getCustomTool(name);
      if (!custom) throw new Error(`${name} is not in the registry with every provider on`);
      const vendorBacked = !isToolAvailable(name, paidProvidersOff);
      expect({ name, paid: custom.paid }).toEqual({
        name,
        paid: vendorBacked && !freeVendorTools.has(name),
      });
    }
  });
});

describe('starting a scheduled task run now', () => {
  async function seedTask() {
    await putOnPro();
    const id = randomUUID();
    await db.execute(sql`insert into task (id, workspace_id, created_by_user_id, title, description, status, trigger_type, cron_schedule, anthropic_deployment_id)
      values (${id}, ${workspaceId}, ${USER}, 'Task', 'Do work', 'upcoming', 'schedule', '0 9 * * *', ${`depl-${id}`})`);
    return id;
  }
  const runNow = (taskId: string) =>
    withRequestContext({ route: 'test/run-now' }, () =>
      runTaskNow({ taskId, workspaceId, userId: USER }),
    );

  test('run now at an empty balance is refused before the provider is asked to run', async () => {
    const taskId = await seedTask();
    await expect(runNow(taskId)).rejects.toMatchObject({ code: 'CREDITS_EXHAUSTED' });
    expect(provider.run).not.toHaveBeenCalled();
  });

  test('two simultaneous run-now presses start one provider run, with no automatic retry', async () => {
    const taskId = await seedTask();
    await seedCreditBalance(db, workspaceId, 100);
    provider.run.mockRejectedValue(new Error('ambiguous timeout'));

    await Promise.allSettled([runNow(taskId), runNow(taskId)]);

    expect(provider.run).toHaveBeenCalledTimes(1);
    expect(provider.run).toHaveBeenCalledWith(`depl-${taskId}`, {}, { maxRetries: 0 });
  });

  test('a failed run now frees the claim only when the provider definitely did not start it', async () => {
    await seedCreditBalance(db, workspaceId, 100);
    for (const status of [400, 429, 408, 409, 500]) {
      const taskId = await seedTask();
      provider.run.mockRejectedValueOnce(new APIError(status, undefined, 'Failed', undefined));
      await expect(runNow(taskId)).rejects.toThrow();
      const { rows } = await db.execute(
        sql`select run_now_claimed_at from task where id = ${taskId}`,
      );
      expect({ status, released: rows[0]?.run_now_claimed_at === null }).toEqual({
        status,
        released: status === 400 || status === 429,
      });
    }
  });
});
