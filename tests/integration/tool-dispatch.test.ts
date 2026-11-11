// Custom tool calls on real Postgres: which calls may run, the per-tool Allow/Ask/Block gate,
// parked approvals and their answers. Only the Anthropic client and the signed-in user are replaced.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { anthropicEventPoster } from '@/features/sessions/api/anthropic-events';
import { authorizeSessionWriteForActor } from '@/features/sessions/api/session-access';
import type { DispatchContext, ToolCall } from '@/features/tool-catalog/types';
import { confirmPendingTools } from '@/features/tools/api/confirm';
import {
  dispatchBatch as dispatchClaimedBatch,
  dispatchCustomTool as dispatchClaimedTool,
  prepareCustomToolDispatchGates,
} from '@/features/tools/api/dispatch';
import { recoverClaimedCustomToolCalls } from '@/features/tools/api/dispatch-recovery';
import { recoverToolDelivery } from '@/features/tools/api/tool-delivery';
import {
  claimAnthropicCustomToolCalls,
  expireToolDecisions,
} from '@/features/tools/api/tool-delivery-transitions';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { writeGrantForTest } from './helpers/session-grant';
import { makeTestDb, makeTestPool } from './helpers/test-db';

type UpstreamEvent = Record<string, unknown> & { id: string; type: string };

const upstream = vi.hoisted(() => ({
  viewer: { userId: 'user_t', organizationId: 'org_t' },
  /** Newest last, as the session emitted them. */
  events: [] as UpstreamEvent[],
  sends: [] as Array<{ events: Array<Record<string, unknown>> }>,
}));

// eslint-disable-next-line no-restricted-syntax -- the per-tool gate is the same for every configurable tool; the library tools stand in because they need no provider and leave a row to read, but are not configurable in production
vi.mock('@/features/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/permissions')>()),
  isConfigurableCustomTool: () => true,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/server', () => ({ after: () => undefined }));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => upstream.viewer),
);
vi.mock('@/features/agents', () => {
  const PAGE = 200;
  const client = {
    beta: {
      sessions: {
        events: {
          // Newest first in pages, the way the API answers order=desc.
          list: async (_sessionId: string, params: { page?: string } = {}) => {
            const newestFirst = [...upstream.events].reverse();
            const start = Number(params.page ?? 0);
            const data = newestFirst.slice(start, start + PAGE);
            const next = start + PAGE < newestFirst.length ? String(start + PAGE) : null;
            return {
              data,
              next_page: next,
              async *[Symbol.asyncIterator]() {
                yield* data;
              },
            };
          },
          send: async (_sessionId: string, body: { events: Array<Record<string, unknown>> }) => {
            upstream.sends.push({ events: body.events });
            for (const event of body.events)
              if (event.type === 'user.custom_tool_result')
                upstream.events.push({
                  id: `result_${upstream.events.length}`,
                  type: 'user.custom_tool_result',
                  custom_tool_use_id: event.custom_tool_use_id,
                });
            return {};
          },
        },
      },
    },
  };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});

const { POST } = await import('@/app/api/custom-tools/dispatch/route');
const pool = makeTestPool();
const db = makeTestDb(pool);

beforeAll(async () => {
  await applyMigrations(db);
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await truncateAll(db);
  upstream.viewer = { userId: 'user_t', organizationId: 'org_t' };
  upstream.events = [];
  upstream.sends = [];
});
afterAll(async () => {
  await pool.end();
});

type Posted =
  | { kind: 'result'; toolUseId: string; isError: boolean; content: unknown }
  | { kind: 'confirmation'; toolUseId: string; result: 'allow' | 'deny' };

/** Replaces the event transport and records what would reach Anthropic. */
function recordingPoster(): { posts: Posted[] } {
  const posts: Posted[] = [];
  vi.spyOn(anthropicEventPoster, 'postCustomToolResult').mockImplementation(
    async ({ toolUseId, isError, content }) => {
      posts.push({ kind: 'result', toolUseId, isError, content });
    },
  );
  vi.spyOn(anthropicEventPoster, 'isToolResultDelivered').mockResolvedValue(false);
  vi.spyOn(anthropicEventPoster, 'postToolConfirmation').mockImplementation(
    async ({ toolUseId, result }) => {
      posts.push({ kind: 'confirmation', toolUseId, result });
    },
  );
  return { posts };
}

async function dispatchBatch(calls: ToolCall[], ctx: DispatchContext) {
  const prepared = await prepareCustomToolDispatchGates(calls, ctx);
  await claimAnthropicCustomToolCalls(ctx.sessionRowId, calls, prepared.parkedCalls);
  return dispatchClaimedBatch(calls, ctx, prepared.gates);
}
async function dispatchCustomTool(call: ToolCall, ctx: DispatchContext) {
  const prepared = await prepareCustomToolDispatchGates([call], ctx);
  await claimAnthropicCustomToolCalls(ctx.sessionRowId, [call], prepared.parkedCalls);
  return dispatchClaimedTool(call, ctx, prepared.gates);
}

function grantFor(ctx: DispatchContext) {
  return writeGrantForTest({
    workspaceId: ctx.workspaceId,
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    sessionRowId: ctx.sessionRowId,
    anthropicSessionId: ctx.anthropicSessionId,
  });
}

const allow = (toolUseId: string) => ({ toolUseId, decision: 'allow' as const });

async function seedSessionContext(): Promise<DispatchContext> {
  const orgId = 'org_t';
  const userId = 'user_t';
  await seedUser(db, userId);
  await seedOrganization(db, orgId);
  const workspaceId = first(
    (
      await db.execute<{ id: string }>(
        sql`insert into workspace (organization_id, name) values (${orgId}, 'Original') returning id`,
      )
    ).rows,
  ).id;
  const sessionRowId = first(
    (
      await db.execute<{ id: string }>(
        sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, anthropic_session_id, permission_mode)
          values ('read_write', ${workspaceId}, 'default', ${userId}, 'chat', 'sess_t', 'ask') returning id`,
      )
    ).rows,
  ).id;
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('member_t', ${orgId}, ${userId}, 'owner', now())`,
  );
  return {
    anthropicSessionId: 'sess_t',
    sessionRowId,
    workspaceId,
    organizationId: orgId,
    userId,
    actorUserId: userId,
  };
}

// Custom tools are governed under the `builtin` sentinel toolkit, keyed by the tool's own name.
async function setCustomToolPolicy(
  ctx: DispatchContext,
  toolName: string,
  policy: 'allow' | 'ask' | 'block',
): Promise<void> {
  await db.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id)
        values (${ctx.organizationId}, ${ctx.userId}, ${`composio_${ctx.userId}`})
        on conflict do nothing`,
  );
  await db.execute(
    sql`insert into tool_permission (organization_id, user_id, toolkit, tool_name, policy)
        values (${ctx.organizationId}, ${ctx.userId}, 'builtin', ${toolName}, ${policy})`,
  );
}

async function pendingRows(sessionRowId: string) {
  return (
    await db.execute<{ tool_use_id: string; status: string }>(
      sql`select tool_use_id, status from pending_confirmation where session_id = ${sessionRowId} order by created_at`,
    )
  ).rows;
}

async function folderCount() {
  return (await db.execute(sql`select id from folder`)).rows.length;
}

const FOLDER_CALL = { name: 'create_library_folder', input: { path: '/Test folder' } };
const DELETE_CALL = { name: 'delete_library_item', input: { path: '/Team/test.txt' } };

describe('only calls the agent emitted run', () => {
  async function routeSession() {
    const ctx = await seedSessionContext();
    await seedUser(db, 'stranger');
    await seedOrganization(db, 'org_other');
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role, created_at) values ('stranger-member', 'org_other', 'stranger', 'owner', now())`,
    );
    await db.execute(
      sql`insert into workspace (organization_id, name) values ('org_other', 'Other')`,
    );
    return ctx;
  }

  function emit(id: string, input: Record<string, unknown> = {}) {
    upstream.events.push({ id, type: 'agent.custom_tool_use', name: 'list_skills', input });
  }

  function dispatchRoute(
    ctx: DispatchContext,
    toolUseIds: string[],
    extra: Record<string, unknown> = {},
  ) {
    return POST(
      new Request('http://localhost/api/custom-tools/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: ctx.sessionRowId,
          calls: toolUseIds.map((toolUseId) => ({ toolUseId, name: 'list_skills', ...extra })),
        }),
      }),
    );
  }

  function postedResults() {
    return upstream.sends.flatMap((send) =>
      send.events.filter((event) => event.type === 'user.custom_tool_result'),
    );
  }

  async function dispatchRows() {
    return (
      await db.execute<{ tool_use_id: string; status: string }>(
        sql`select tool_use_id, status from custom_tool_dispatch order by tool_use_id`,
      )
    ).rows;
  }

  test('an invented tool-use id is refused before anything is claimed or run', async () => {
    const ctx = await routeSession();
    const response = await dispatchRoute(ctx, ['tool_forged']);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'TOOL_INPUT_INVALID' },
    });
    expect(await dispatchRows()).toEqual([]);
    expect(postedResults()).toEqual([]);
  });

  test('a genuine call posts its result once and a replay is refused as already resolved', async () => {
    const ctx = await routeSession();
    emit('tool_real');

    const response = await dispatchRoute(ctx, ['tool_real']);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcomes: [{ toolUseId: 'tool_real', name: 'list_skills', status: 'posted', isError: false }],
    });
    expect(await dispatchRows()).toEqual([{ tool_use_id: 'tool_real', status: 'completed' }]);

    const replay = await dispatchRoute(ctx, ['tool_real']);
    expect(replay.status).toBe(400);
    await expect(replay.json()).resolves.toMatchObject({
      error: { code: 'CUSTOM_TOOL_ALREADY_RESOLVED', toolUseId: 'tool_real' },
    });
    expect(postedResults()).toEqual([
      expect.objectContaining({ custom_tool_use_id: 'tool_real', is_error: false }),
    ]);
  });

  test('two concurrent dispatches of one call run it and post its result once', async () => {
    const ctx = await routeSession();
    emit('tool_real');

    const responses = await Promise.all([
      dispatchRoute(ctx, ['tool_real']),
      dispatchRoute(ctx, ['tool_real']),
    ]);

    expect(responses.every((response) => [200, 400].includes(response.status))).toBe(true);
    expect(await dispatchRows()).toEqual([{ tool_use_id: 'tool_real', status: 'completed' }]);
    expect(postedResults()).toHaveLength(1);
  });

  test('a member of another workspace cannot dispatch for this session', async () => {
    const ctx = await routeSession();
    emit('tool_real');
    upstream.viewer = { userId: 'stranger', organizationId: 'org_other' };

    const response = await dispatchRoute(ctx, ['tool_real']);

    expect(response.status).toBe(404);
    expect(await dispatchRows()).toEqual([]);
    expect(postedResults()).toEqual([]);
  });

  test('a call behind more than one page of session events is still found and run', async () => {
    const ctx = await routeSession();
    emit('tool_real');
    for (let index = 0; index < 250; index += 1)
      upstream.events.push({
        id: `noise_${index}`,
        type: 'user.custom_tool_result',
        custom_tool_use_id: `other_${index}`,
      });

    const response = await dispatchRoute(ctx, ['tool_real']);

    expect(response.status).toBe(200);
    expect(postedResults()).toEqual([expect.objectContaining({ custom_tool_use_id: 'tool_real' })]);
  });

  test('the input the agent emitted runs, never an input the caller sends', async () => {
    const ctx = await routeSession();
    emit('tool_real', { query: 'invoices' });

    const response = await dispatchRoute(ctx, ['tool_real'], {
      input: { query: 'x'.repeat(500) },
    });

    expect(response.status).toBe(200);
    expect(postedResults()).toEqual([
      expect.objectContaining({ custom_tool_use_id: 'tool_real', is_error: false }),
    ]);
  });
});

describe('the per-tool gate', () => {
  test.each([
    { policy: undefined, status: 'posted', blocked: false },
    { policy: 'allow', status: 'posted', blocked: false },
    { policy: 'block', status: 'posted', blocked: true },
  ] as const)('policy $policy: runs or refuses without parking ($status, blocked $blocked)', async ({
    policy,
    status,
    blocked,
  }) => {
    const ctx = await seedSessionContext();
    if (policy) await setCustomToolPolicy(ctx, FOLDER_CALL.name, policy);
    const { posts } = recordingPoster();

    const outcome = await dispatchCustomTool({ toolUseId: 'tu_1', ...FOLDER_CALL }, ctx);

    expect(outcome).toMatchObject({ status, isError: false });
    expect(posts).toEqual([expect.objectContaining({ kind: 'result', isError: false })]);
    expect(await pendingRows(ctx.sessionRowId)).toEqual([]);
    expect(await folderCount()).toBe(blocked ? 0 : 1);
    if (blocked) expect(first(posts)).toMatchObject({ content: { blocked: true } });
  });

  test('an Ask row parks the call: a pending row is written and nothing posts', async () => {
    const ctx = await seedSessionContext();
    await setCustomToolPolicy(ctx, FOLDER_CALL.name, 'ask');
    const { posts } = recordingPoster();

    const outcome = await dispatchCustomTool({ toolUseId: 'tu_1', ...FOLDER_CALL }, ctx);

    expect(outcome.status).toBe('pending');
    expect(posts).toEqual([]);
    expect(await pendingRows(ctx.sessionRowId)).toEqual([
      { tool_use_id: 'tu_1', status: 'pending' },
    ]);
    expect(await folderCount()).toBe(0);
  });

  test.each([
    { toolUseId: 'tu_delete', ...DELETE_CALL },
    { toolUseId: 'tu_delete_skill', name: 'delete_skill', input: { name: 'Old report' } },
  ])('$name always asks first, even with no permission row', async (call) => {
    const ctx = await seedSessionContext();
    const { posts } = recordingPoster();

    expect((await dispatchCustomTool(call, ctx)).status).toBe('pending');
    expect(posts).toEqual([]);
    expect(await pendingRows(ctx.sessionRowId)).toEqual([
      { tool_use_id: call.toolUseId, status: 'pending' },
    ]);
  });

  test('saving or updating a workspace skill still asks under Allow in an unattended run', async () => {
    const ctx = await seedSessionContext();
    await db.execute(
      sql`update session set kind = 'task_run', permission_mode = 'auto' where id = ${ctx.sessionRowId}`,
    );
    await setCustomToolPolicy(ctx, 'save_skill', 'allow');
    await setCustomToolPolicy(ctx, 'update_skill', 'allow');
    const { posts } = recordingPoster();
    const files = [{ path: 'SKILL.md', content: '# Skill' }];

    const outcomes = await dispatchBatch(
      [
        { toolUseId: 'tu_save', name: 'save_skill', input: { name: 'Monthly report', files } },
        {
          toolUseId: 'tu_update',
          name: 'update_skill',
          input: { current_name: 'Monthly report', name: 'Monthly report', files },
        },
      ],
      ctx,
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['pending', 'pending']);
    expect(posts).toEqual([]);
    expect(await pendingRows(ctx.sessionRowId)).toHaveLength(2);
  });

  // No provider is configured in this file, so each tool's provider check is the only gate.
  test.each([
    'web_search_exa',
    'browse_page',
    'generate_image',
    'missing_tool',
  ])('%s without its provider stores a not-found refusal and sends it once', async (name) => {
    const ctx = await seedSessionContext();
    const { posts } = recordingPoster();
    expect(await dispatchCustomTool({ toolUseId: name, name, input: {} }, ctx)).toMatchObject({
      detail: 'TOOL_NOT_FOUND',
      isError: true,
    });
    expect(posts).toHaveLength(1);
    expect(
      (
        await db.execute(
          sql`select status, delivery from custom_tool_dispatch where tool_use_id = ${name}`,
        )
      ).rows,
    ).toEqual([{ status: 'completed', delivery: null }]);
  });

  test("the session creator's permissions and identity apply, whoever triggers the call", async () => {
    const ctx = await seedSessionContext();
    await seedUser(db, 'viewer');
    await setCustomToolPolicy(ctx, FOLDER_CALL.name, 'block');
    const recording = recordingPoster();
    const asViewer = { ...ctx, userId: 'viewer' };
    await dispatchCustomTool({ toolUseId: 'tu_creator_block', ...FOLDER_CALL }, asViewer);
    expect(recording.posts).toEqual([
      expect.objectContaining({ content: expect.objectContaining({ blocked: true }) }),
    ]);
    expect(await folderCount()).toBe(0);

    await db.execute(sql`delete from tool_permission where user_id = ${ctx.actorUserId}`);
    await setCustomToolPolicy(ctx, FOLDER_CALL.name, 'allow');
    await dispatchCustomTool({ toolUseId: 'tu_creator_write', ...FOLDER_CALL }, asViewer);
    expect((await db.execute(sql`select created_by_user_id from folder`)).rows).toEqual([
      { created_by_user_id: ctx.actorUserId },
    ]);
  });

  test('a creator removed from the organization gets FORBIDDEN instead of a parked approval', async () => {
    const ctx = await seedSessionContext();
    await setCustomToolPolicy(ctx, DELETE_CALL.name, 'ask');
    await db.execute(sql`delete from member where user_id = ${ctx.actorUserId}`);
    const { posts } = recordingPoster();
    await dispatchCustomTool({ toolUseId: 'removed-ask', ...DELETE_CALL }, ctx);
    expect(await pendingRows(ctx.sessionRowId)).toEqual([]);
    expect(posts).toEqual([
      expect.objectContaining({
        isError: true,
        content: expect.objectContaining({ code: 'FORBIDDEN' }),
      }),
    ]);
  });
});

describe('answering a parked call', () => {
  async function parkedFolderCall(toolUseIds = ['tu_1']) {
    const ctx = await seedSessionContext();
    await setCustomToolPolicy(ctx, FOLDER_CALL.name, 'ask');
    recordingPoster();
    await dispatchBatch(
      toolUseIds.map((toolUseId, index) => ({
        toolUseId,
        name: FOLDER_CALL.name,
        input: { path: `/Test folder ${index}` },
      })),
      ctx,
    );
    return ctx;
  }

  test('approval runs the handler and posts one result; a repeated approval posts nothing', async () => {
    const ctx = await parkedFolderCall();

    const confirm = recordingPoster();
    const outcomes = await confirmPendingTools({
      grant: grantFor(ctx),
      decisions: [allow('tu_1')],
    });
    expect(outcomes).toMatchObject([{ toolUseId: 'tu_1', status: 'resolved' }]);
    expect(confirm.posts).toEqual([expect.objectContaining({ kind: 'result', toolUseId: 'tu_1' })]);
    expect(await pendingRows(ctx.sessionRowId)).toMatchObject([{ status: 'approved' }]);
    expect(await folderCount()).toBe(1);

    const replay = recordingPoster();
    const replayOutcomes = await confirmPendingTools({
      grant: grantFor(ctx),
      decisions: [allow('tu_1')],
    });
    expect(replayOutcomes).toMatchObject([{ toolUseId: 'tu_1', status: 'resolved' }]);
    expect(replay.posts).toEqual([]);
    expect(await folderCount()).toBe(1);
  });

  test('one answer to a batch of parked calls posts every result', async () => {
    const ctx = await parkedFolderCall(['tu_1', 'tu_2', 'tu_3']);
    expect(await pendingRows(ctx.sessionRowId)).toHaveLength(3);

    const confirm = recordingPoster();
    await confirmPendingTools({
      grant: grantFor(ctx),
      decisions: [allow('tu_1'), allow('tu_2'), allow('tu_3')],
    });

    expect(confirm.posts.map((post) => post.toolUseId).sort()).toEqual(['tu_1', 'tu_2', 'tu_3']);
  });

  test('a denial posts a USER_DENIED error result and never runs the handler', async () => {
    const ctx = await parkedFolderCall();

    const confirm = recordingPoster();
    await confirmPendingTools({
      grant: grantFor(ctx),
      decisions: [{ toolUseId: 'tu_1', decision: 'deny' }],
    });

    expect(confirm.posts).toEqual([
      { kind: 'result', toolUseId: 'tu_1', isError: true, content: expect.anything() },
    ]);
    expect(await folderCount()).toBe(0);
  });

  test('a failed send keeps the approval and a later answer delivers the stored result once', async () => {
    const ctx = await parkedFolderCall();
    recordingPoster();
    vi.mocked(anthropicEventPoster.postCustomToolResult).mockRejectedValueOnce(
      new Error('anthropic send failed'),
    );
    expect(
      await confirmPendingTools({ grant: grantFor(ctx), decisions: [allow('tu_1')] }),
    ).toMatchObject([{ toolUseId: 'tu_1', status: 'skipped', detail: 'DELIVERY_PENDING' }]);
    expect(await pendingRows(ctx.sessionRowId)).toMatchObject([{ status: 'approved' }]);

    const retry = recordingPoster();
    await confirmPendingTools({ grant: grantFor(ctx), decisions: [allow('tu_1')] });
    expect(retry.posts).toHaveLength(1);
    expect(await folderCount()).toBe(1);
  });

  test("a teammate cannot answer the creator's parked call", async () => {
    const ctx = await parkedFolderCall(['tu_actor']);
    await seedUser(db, 'user_approver');
    await expect(
      authorizeSessionWriteForActor({
        sessionId: ctx.sessionRowId,
        workspaceId: ctx.workspaceId,
        userId: 'user_approver',
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_WRITABLE' });
    expect(await pendingRows(ctx.sessionRowId)).toMatchObject([{ status: 'pending' }]);
    expect(await folderCount()).toBe(0);
  });

  test('recovery denies a parked call once its creator has left the organization', async () => {
    const ctx = await seedSessionContext();
    const call = { toolUseId: 'parked-removed', ...DELETE_CALL };
    const { posts } = recordingPoster();
    await dispatchCustomTool(call, ctx);
    expect(await pendingRows(ctx.sessionRowId)).toHaveLength(1);
    await db.execute(sql`delete from member where user_id = ${ctx.actorUserId}`);
    await expireToolDecisions(ctx.sessionRowId);
    await recoverToolDelivery(ctx, call.toolUseId);
    expect(posts).toEqual([
      expect.objectContaining({
        isError: true,
        content: expect.objectContaining({ code: 'FORBIDDEN' }),
      }),
    ]);
    expect(await pendingRows(ctx.sessionRowId)).toMatchObject([{ status: 'denied' }]);
  });
});

describe('claims and recovery', () => {
  test('when parking fails the claim rolls back too, so the call is not lost half-claimed', async () => {
    const ctx = await seedSessionContext();
    const call = { toolUseId: 'tu_failed_park', ...DELETE_CALL };
    await expect(
      claimAnthropicCustomToolCalls(
        ctx.sessionRowId,
        [call],
        [{ ...call, workspaceId: randomUUID(), requestedByUserId: ctx.userId }],
      ),
    ).rejects.toBeDefined();

    const [claims, confirmations] = await Promise.all([
      db.execute(
        sql`select tool_use_id from custom_tool_dispatch where tool_use_id = ${call.toolUseId}`,
      ),
      db.execute(
        sql`select tool_use_id from pending_confirmation where tool_use_id = ${call.toolUseId}`,
      ),
    ]);
    expect(claims.rows).toEqual([]);
    expect(confirmations.rows).toEqual([]);
  });

  test('a policy changed to Ask after a call started cannot release it to run a second time', async () => {
    const ctx = await seedSessionContext();
    const call = { toolUseId: 'tu_handler_claim', ...FOLDER_CALL };
    await claimAnthropicCustomToolCalls(ctx.sessionRowId, [call]);
    await setCustomToolPolicy(ctx, call.name, 'ask');

    await expect(recoverClaimedCustomToolCalls([call], ctx)).resolves.toMatchObject({
      outcomes: [{ status: 'retry', detail: 'EXECUTING' }],
      retryCalls: [],
    });
    const claims = await db.execute(
      sql`select tool_use_id from custom_tool_dispatch where tool_use_id = ${call.toolUseId}`,
    );
    expect(claims.rows).toEqual([{ tool_use_id: call.toolUseId }]);
  });

  test('the gate read before the claim decides the call even if the policy changes before it runs', async () => {
    const ctx = await seedSessionContext();
    await setCustomToolPolicy(ctx, FOLDER_CALL.name, 'allow');
    const call = { toolUseId: 'tu_gate_snapshot', ...FOLDER_CALL };
    const prepared = await prepareCustomToolDispatchGates([call], ctx);
    await db.execute(sql`update tool_permission set policy = 'ask' where tool_name = ${call.name}`);
    await claimAnthropicCustomToolCalls(ctx.sessionRowId, [call], prepared.parkedCalls);
    const { posts } = recordingPoster();

    const outcomes = await dispatchClaimedBatch([call], ctx, prepared.gates);

    expect(outcomes).toEqual([
      expect.objectContaining({ toolUseId: call.toolUseId, status: 'posted', isError: false }),
    ]);
    expect(posts).toHaveLength(1);
    expect(await pendingRows(ctx.sessionRowId)).toEqual([]);
  });

  test('a replayed claim of a parked call reports it still pending instead of running it', async () => {
    const ctx = await seedSessionContext();
    const call = { toolUseId: 'tu_pending_replay', ...DELETE_CALL };
    await claimAnthropicCustomToolCalls(
      ctx.sessionRowId,
      [call],
      [{ ...call, workspaceId: ctx.workspaceId, requestedByUserId: ctx.userId }],
    );

    expect(await recoverClaimedCustomToolCalls([call], ctx)).toEqual({
      outcomes: [{ toolUseId: call.toolUseId, name: call.name, status: 'pending' }],
      retryCalls: [],
    });
  });

  test('a refusal whose send failed is resent as the refusal, not as an interrupted run', async () => {
    const ctx = await seedSessionContext();
    await setCustomToolPolicy(ctx, FOLDER_CALL.name, 'block');
    const { posts } = recordingPoster();
    vi.mocked(anthropicEventPoster.postCustomToolResult).mockRejectedValueOnce(
      new Error('send failed'),
    );
    await expect(dispatchCustomTool({ ...FOLDER_CALL, toolUseId: 'blocked' }, ctx)).rejects.toThrow(
      'send failed',
    );
    expect(await recoverToolDelivery(ctx, 'blocked')).toMatchObject({
      status: 'posted',
      detail: 'POLICY_BLOCKED',
      isError: false,
    });
    expect(posts).toMatchObject([{ content: { blocked: true } }]);
  });
});

function first<T>(values: readonly T[]): T {
  const value = values.at(0);
  if (value === undefined) throw new Error('Fixture row is missing');
  return value;
}
