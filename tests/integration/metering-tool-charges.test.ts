// Charging for custom tools and media generation through the real dispatcher, on real Postgres.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { creditBalanceProjection, seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const fakes = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  interrupt: vi.fn(async () => {}),
  capture: vi.fn(),
}));
vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => fakes.afterCallbacks.push(callback),
}));
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, { AI_GATEWAY_API_KEY: 'test-gateway-key' }),
);
vi.mock('@/lib/observability', async (original) => ({
  ...(await original<typeof import('@/lib/observability')>()),
  captureException: fakes.capture,
}));
vi.mock('@/features/agents/api/anthropic-client', () => {
  const client = () => ({ beta: { sessions: { events: { send: fakes.interrupt } } } });
  return { getAnthropicClient: client, requireAnthropicClient: client };
});

const { accrueToolCall } = await import('@/features/billing/api/accrue-tool-call');
const { creditsForVendorCents } = await import('@/features/billing/lib/credit-math');
const { anthropicEventPoster } = await import('@/features/sessions/api/anthropic-events');
const { runAndPost } = await import('@/features/tools/api/dispatch-execution');
const { generateImageTool } = await import('@/features/tools/custom-tools/generate-image');
const { bindTool } = await import('@/features/tools/lib/bind-tool');
const { PaidToolError, unsavedMediaError } = await import('@/features/tools/lib/paid-tool-error');
const { GenerateImageInputSchema, GenerateImageOutputSchema } = await import(
  '@/features/tool-catalog/generate-image'
);
const { GenerateVideoInputSchema, GenerateVideoOutputSchema } = await import(
  '@/features/tool-catalog/generate-video'
);
const { IntegrationError } = await import('@/lib/errors');
type CustomTool<I, O> = import('@/features/tool-catalog/types').CustomTool<I, O>;
type GenerateImage = CustomTool<
  import('@/features/tool-catalog/generate-image').GenerateImageInput,
  import('@/features/tool-catalog/generate-image').GenerateImageOutput
>;
type GenerateVideo = CustomTool<
  import('@/features/tool-catalog/generate-video').GenerateVideoInput,
  import('@/features/tool-catalog/generate-video').GenerateVideoOutput
>;

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_tool_charges';
const USER = 'user_tool_charges';

type Posted = { sessionId: string; toolUseId: string; isError: boolean; content: unknown };
const posted = vi.fn<(args: Posted) => Promise<void>>(async () => {});

beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  fakes.afterCallbacks.length = 0;
  vi.clearAllMocks();
  posted.mockImplementation(async () => {});
  vi.spyOn(anthropicEventPoster, 'postCustomToolResult').mockImplementation(posted);
  vi.spyOn(anthropicEventPoster, 'isToolResultDelivered').mockResolvedValue(false);
  vi.spyOn(anthropicEventPoster, 'postToolConfirmation').mockResolvedValue(undefined);
  await seedOrganization(db, ORG);
  await seedUser(db, USER);
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('tool-charges-owner', ${ORG}, ${USER}, 'owner', now())`);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedChat(balance: number) {
  const workspaceId = randomUUID();
  await db.execute(
    sql`insert into workspace (id, organization_id, name) values (${workspaceId}, ${ORG}, 'Tools')`,
  );
  await seedCreditBalance(db, workspaceId, balance);
  const sessionRowId = randomUUID();
  const anthropicSessionId = `asess_${sessionRowId}`;
  await db.execute(
    sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, status, anthropic_session_id)
        values ('read_write', ${sessionRowId}, ${workspaceId}, 'default', ${USER}, 'chat', 'running', ${anthropicSessionId})`,
  );
  return { workspaceId, sessionRowId, anthropicSessionId };
}
type Chat = Awaited<ReturnType<typeof seedChat>>;

// Dispatches as the router does: the dispatch row exists, the input is prepared, then after()
// work runs as it would once the response has gone.
async function dispatch<I, O>(
  tool: CustomTool<I, O>,
  input: unknown,
  toolUseId: string,
  chat: Chat,
) {
  await db.execute(
    sql`insert into custom_tool_dispatch (session_id, tool_use_id, tool_name)
        values (${chat.sessionRowId}, ${toolUseId}, ${tool.name}) on conflict do nothing`,
  );
  const bound = bindTool(tool);
  const prepared = bound.prepare(input);
  if (!prepared.success) throw prepared.error;
  const outcome = await runAndPost(bound, prepared.data, toolUseId, {
    ...chat,
    userId: USER,
    actorUserId: USER,
  });
  for (const callback of fakes.afterCallbacks.splice(0)) await callback();
  return outcome;
}

async function balanceOf(workspaceId: string): Promise<number> {
  const { rows } = await db.execute<{ credit_balance: number }>(
    sql`select ${creditBalanceProjection} from workspace where id = ${workspaceId}`,
  );
  return requiredRow(rows.at(0)).credit_balance;
}

async function usageEvents(workspaceId: string) {
  const { rows } = await db.execute<{
    event_type: string;
    credits_delta: number;
    usage_key: string;
  }>(
    sql`select event_type, credits_delta, usage_key from usage_event
        where workspace_id = ${workspaceId} order by created_at`,
  );
  return rows;
}

function lastPosted(): Posted {
  return requiredRow(posted.mock.calls.at(-1)).at(0) as Posted;
}

const costedTool: CustomTool<Record<string, unknown>, { ok: boolean }> = {
  name: 'costed_tool',
  description: 'a tool with a vendor bill',
  riskLevel: 'safe',
  inputJsonSchema: { type: 'object' },
  inputSchema: z.object({}).loose(),
  outputSchema: z.object({ ok: z.boolean() }),
  handler: async () => ({ ok: true }),
  measureVendorCostCents: () => 30,
  estimateCredits: () => 0,
};

// The real generate_image shape with only the Gateway and Library half replaced.
function stubbedImage(mode: 'success' | 'provider-down'): GenerateImage {
  return {
    name: 'generate_image',
    description: 'stubbed generate_image',
    riskLevel: 'safe',
    inputJsonSchema: { type: 'object' },
    inputSchema: GenerateImageInputSchema,
    outputSchema: GenerateImageOutputSchema,
    accrualSource: 'generation',
    mediaBilling: (output) => output.mediaBilling,
    estimateCredits: () => 2,
    async handler({ prompt, quality, size }) {
      if (mode === 'provider-down')
        throw new IntegrationError('EXTERNAL_API_FAILED', 'Image generation failed', {
          status: 503,
        });
      return {
        image: {
          url: 'https://files.example/test/raw/ws/Generated%20images/stub.png',
          filename: `${prompt.slice(0, 8)}.png`,
          folderPath: '/Generated images',
          width: 1024,
          height: 1024,
        },
        quality,
        size,
        mediaBilling: {
          generationId: null,
          model: 'openai/gpt-image-2',
          estimatedCostCents: 1.317,
        },
      };
    },
  };
}

function stubbedVideo(handler: GenerateVideo['handler']): GenerateVideo {
  return {
    name: 'generate_video',
    description: 'stubbed generate_video',
    riskLevel: 'safe',
    inputJsonSchema: { type: 'object' },
    inputSchema: GenerateVideoInputSchema,
    outputSchema: GenerateVideoOutputSchema,
    accrualSource: 'generation',
    mediaBilling: (output) => output.mediaBilling,
    estimateCredits: () => 2,
    handler,
  };
}

const imageInput = () => GenerateImageInputSchema.parse({ prompt: 'a watercolor map of vilnius' });
const videoInput = () => GenerateVideoInputSchema.parse({ prompt: 'a drone shot' });

describe('custom tool charges', () => {
  test('a tool result is posted before it is charged, and a retried accrual never charges twice', async () => {
    const chat = await seedChat(100);
    let balanceWhenPosted: number | null = null;
    posted.mockImplementation(async () => {
      balanceWhenPosted = await balanceOf(chat.workspaceId);
    });

    expect(await dispatch(costedTool, {}, 'toolu_costed', chat)).toMatchObject({
      status: 'posted',
      isError: false,
    });
    expect(balanceWhenPosted).toBe(100);
    expect(await balanceOf(chat.workspaceId)).toBe(70);
    expect(await usageEvents(chat.workspaceId)).toEqual([
      { event_type: 'tool_call', credits_delta: -30, usage_key: 'tool:toolu_costed' },
    ]);

    await accrueToolCall({
      source: 'tool_call',
      anthropicSessionId: chat.anthropicSessionId,
      toolUseId: 'toolu_costed',
      toolName: costedTool.name,
      vendorCostCents: 30,
    });
    expect(await balanceOf(chat.workspaceId)).toBe(70);
  });

  test('a billing failure after delivery keeps the successful result and charges nothing', async () => {
    const chat = await seedChat(100);
    // Delivery stays authoritative; the failed charge stays recoverable in the dispatch journal.
    await db.execute(
      sql`create function reject_tool_usage() returns trigger language plpgsql as $$ begin raise exception 'billing failed'; end $$`,
    );
    await db.execute(
      sql`create trigger reject_tool_usage before insert on usage_event for each row execute function reject_tool_usage()`,
    );
    try {
      await expect(dispatch(costedTool, {}, 'toolu_billing_fails', chat)).rejects.toBeDefined();
    } finally {
      await db.execute(sql`drop trigger reject_tool_usage on usage_event`);
      await db.execute(sql`drop function reject_tool_usage()`);
    }

    const { rows } = await db.execute(
      sql`select status from custom_tool_dispatch where tool_use_id = 'toolu_billing_fails'`,
    );
    expect(rows).toEqual([{ status: 'delivered' }]);
    expect(posted).toHaveBeenCalledTimes(1);
    expect(lastPosted()).toMatchObject({ isError: false, content: { ok: true } });
    expect(await balanceOf(chat.workspaceId)).toBe(100);
  });

  test('five parallel tool charges on one session are all recorded, none lost to a lock conflict', async () => {
    const chat = await seedChat(1_000);
    const costs = [10, 20, 30, 40, 50];

    const results = await Promise.all(
      costs.map((vendorCostCents, index) =>
        accrueToolCall({
          anthropicSessionId: chat.anthropicSessionId,
          toolUseId: `toolu_parallel_${index}`,
          toolName: costedTool.name,
          vendorCostCents,
          source: 'tool_call',
        }),
      ),
    );

    expect(results.map((result) => result.billed)).toEqual([true, true, true, true, true]);
    expect(fakes.capture).not.toHaveBeenCalled();
    expect(
      (await usageEvents(chat.workspaceId)).map((row) => row.credits_delta).sort((a, b) => b - a),
    ).toEqual([-10, -20, -30, -40, -50]);
    expect(await balanceOf(chat.workspaceId)).toBe(1_000 - 150);
  });
});

describe('media generation charges', () => {
  test('a generated image is charged its vendor cost rounded up, after the post, and the agent never sees the cost', async () => {
    const chat = await seedChat(30);
    let balanceWhenPosted: number | null = null;
    posted.mockImplementation(async () => {
      balanceWhenPosted = await balanceOf(chat.workspaceId);
    });

    expect(
      await dispatch(stubbedImage('success'), imageInput(), 'toolu_image', chat),
    ).toMatchObject({ status: 'posted', isError: false });

    // 1.317 cents rounds up to 2 credits.
    expect(creditsForVendorCents(1.317)).toBe(2);
    expect(balanceWhenPosted).toBe(30);
    expect(await balanceOf(chat.workspaceId)).toBe(28);
    expect(await usageEvents(chat.workspaceId)).toEqual([
      { event_type: 'generation', credits_delta: -2, usage_key: 'tool:toolu_image' },
    ]);
    expect(lastPosted().content).not.toHaveProperty('mediaBilling');
    expect(lastPosted().content).toMatchObject({ image: { folderPath: '/Generated images' } });
  });

  test('an unaffordable image is refused before the Gateway is called, and the pause is published before the interrupt', async () => {
    const chat = await seedChat(1);
    const statusEventsAtInterrupt: number[] = [];
    fakes.interrupt.mockImplementation(async () => {
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from realtime_event where organization_id = ${ORG} and type = 'session_status'`,
      );
      statusEventsAtInterrupt.push(requiredRow(rows.at(0)).n);
    });
    const gateway = vi.fn();
    vi.stubGlobal('fetch', gateway);

    const outcome = await dispatch(
      generateImageTool,
      GenerateImageInputSchema.parse({ prompt: 'a map', quality: 'mid', size: 'square' }),
      'toolu_unaffordable',
      chat,
    );

    expect(outcome).toMatchObject({ isError: true, detail: 'CREDITS_EXHAUSTED' });
    expect(gateway).not.toHaveBeenCalled();
    expect(await balanceOf(chat.workspaceId)).toBe(1);
    expect(await usageEvents(chat.workspaceId)).toHaveLength(0);
    const { rows } = await db.execute(
      sql`select status, paused_reason from session where id = ${chat.sessionRowId}`,
    );
    expect(rows).toEqual([{ status: 'paused_no_credits', paused_reason: 'credits' }]);
    const { rows: events } = await db.execute<{ type: string; payload: Record<string, unknown> }>(
      sql`select type, payload from realtime_event where organization_id = ${ORG} order by id`,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'session_status',
        payload: expect.objectContaining({ status: 'paused_no_credits', pausedReason: 'credits' }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'credits',
        payload: expect.objectContaining({ balance: 1 }),
      }),
    );
    expect(statusEventsAtInterrupt).toEqual([1]);
    expect(lastPosted()).toMatchObject({
      isError: true,
      content: { code: 'CREDITS_EXHAUSTED' },
    });
  });

  test.each([
    {
      kind: 'image',
      run: (chat: Chat) =>
        dispatch(stubbedImage('provider-down'), imageInput(), 'toolu_failed', chat),
    },
    {
      kind: 'video',
      run: (chat: Chat) =>
        dispatch(
          stubbedVideo(async () => {
            throw new IntegrationError('EXTERNAL_API_FAILED', 'Video generation timed out', {});
          }),
          videoInput(),
          'toolu_failed',
          chat,
        ),
    },
  ])('a failed $kind generation costs nothing', async ({ run }) => {
    const chat = await seedChat(100);
    expect(await run(chat)).toMatchObject({
      status: 'posted',
      isError: true,
    });
    expect(lastPosted().content).toMatchObject({ code: 'EXTERNAL_API_FAILED' });
    expect(await balanceOf(chat.workspaceId)).toBe(100);
    expect(await usageEvents(chat.workspaceId)).toHaveLength(0);
  });

  test.each([
    {
      failure: 'the generation succeeded but saving it failed',
      error: () =>
        unsavedMediaError(
          { generationId: null, model: 'test-model', estimatedCostCents: 5 },
          new Error('Storage unavailable'),
        ),
    },
    {
      failure: 'the provider charged and then answered with an unexpected shape',
      error: () => new PaidToolError({ cost: { vendorCostCents: 5 }, message: 'Unexpected shape' }),
    },
  ])('a paid tool failure is charged its known vendor cost once when $failure', async ({
    error,
  }) => {
    const chat = await seedChat(1000);
    const tool = stubbedVideo(async () => {
      throw error();
    });

    expect(await dispatch(tool, videoInput(), 'toolu_paid_failure', chat)).toMatchObject({
      status: 'posted',
      isError: true,
    });
    await dispatch(tool, videoInput(), 'toolu_paid_failure', chat);

    expect(await balanceOf(chat.workspaceId)).toBe(995);
    expect(
      (await usageEvents(chat.workspaceId)).filter((row) => row.credits_delta !== 0),
    ).toHaveLength(1);
  });
});
