// Stored tool results and approval decisions on real Postgres: each result reaches Anthropic once,
// a handler never runs twice, and stored vendor cost is billed once. Only the event transport is replaced.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { claimArtifactSave } from '@/features/files/api/artifact-transitions';
import { discardImportedFile } from '@/features/files/api/trash-transitions';
import { anthropicEventPoster } from '@/features/sessions/api/anthropic-events';
import { confirmPendingTools, listPendingConfirmations } from '@/features/tools/api/confirm';
import { runAndPost } from '@/features/tools/api/dispatch-execution';
import { reconcileToolDeliveries } from '@/features/tools/api/reconcile-tool-deliveries';
import { deliverStoredTool, recoverToolDelivery } from '@/features/tools/api/tool-delivery';
import {
  claimAnthropicCustomToolCalls,
  claimToolDecision,
  expireToolDecisions,
  moveToolDelivery,
} from '@/features/tools/api/tool-delivery-transitions';
import { bindTool } from '@/features/tools/lib/bind-tool';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { writeGrantForTest } from './helpers/session-grant';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const database = makeTestDb(pool);
const workspaceId = randomUUID();
const sessionId = randomUUID();
const privateSessionId = randomUUID();
const posts: Array<{ toolUseId: string; content: unknown }> = [];
let failPost = false;

const context = { sessionRowId: sessionId, anthropicSessionId: 'upstream' };
const grant = writeGrantForTest({
  workspaceId,
  organizationId: 'delivery-tests',
  userId: 'owner',
  sessionRowId: sessionId,
  anthropicSessionId: 'upstream',
});
const decision = {
  anthropicSessionId: 'upstream',
  workspaceId,
  userId: 'owner',
  toolUseId: 'call',
  decision: 'deny' as const,
};
const parkedCall = {
  toolUseId: 'call',
  name: 'delete_library_item',
  input: {},
  workspaceId,
  requestedByUserId: 'owner',
};

beforeAll(async () => applyMigrations(database));
afterAll(async () => pool.end());
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.spyOn(anthropicEventPoster, 'postCustomToolResult').mockImplementation(async (post) => {
    if (failPost) throw new Error('send failed');
    posts.push(post);
  });
  vi.spyOn(anthropicEventPoster, 'isToolResultDelivered').mockResolvedValue(false);
  vi.spyOn(anthropicEventPoster, 'postToolConfirmation').mockResolvedValue(undefined);
  posts.length = 0;
  failPost = false;
  await truncateAll(database);
  await seedUser(database, 'owner');
  await seedOrganization(database, 'delivery-tests');
  await database.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('owner-member', 'delivery-tests', 'owner', 'owner', now())`,
  );
  await database.execute(
    sql`insert into workspace (id, organization_id, name) values (${workspaceId}, 'delivery-tests', 'Tools')`,
  );
  for (const [id, upstream] of [
    [sessionId, 'upstream'],
    [privateSessionId, 'private-upstream'],
  ])
    await database.execute(
      sql`insert into session (workspace_memory_access, id, workspace_id, created_by_user_id, kind, tier, anthropic_session_id) values ('read_write', ${id}, ${workspaceId}, 'owner', 'chat', 'default', ${upstream})`,
    );
});

async function park(id: string) {
  await database.execute(
    sql`insert into pending_confirmation (session_id, workspace_id, tool_use_id, tool_name, input) values (${id}, ${workspaceId}, 'call', 'delete_library_item', '{}')`,
  );
}

async function readyResult(toolUseId = 'call', vendorCostCents?: number) {
  await claimAnthropicCustomToolCalls(sessionId, [{ toolUseId, name: 'test' }], []);
  await moveToolDelivery({
    sessionId,
    toolUseId,
    to: 'ready',
    staleBefore: null,
    delivery: {
      isError: false,
      source: 'tool_call',
      content: 'done',
      ...(vendorCostCents === undefined ? {} : { vendorCostCents }),
    },
  });
}

async function dispatchRow(toolUseId = 'call') {
  return (
    await database.execute(
      sql`select status, delivery from custom_tool_dispatch where tool_use_id = ${toolUseId}`,
    )
  ).rows;
}

async function ageDispatch(interval: string) {
  await database.execute(
    sql`update custom_tool_dispatch set updated_at = now() - ${interval}::interval where tool_use_id = 'call'`,
  );
}

describe('approval decisions', () => {
  test('a grant for one session cannot answer a parked call in another session', async () => {
    await park(privateSessionId);
    expect(await claimToolDecision(decision)).toBeUndefined();
    expect(await confirmPendingTools({ grant, decisions: [decision] })).toEqual([
      { toolUseId: 'call', status: 'skipped', detail: 'NOT_PENDING' },
    ]);
    expect(posts).toEqual([]);
  });

  test('a decision is final: a later opposite answer cannot replace it', async () => {
    await park(sessionId);
    expect(await claimToolDecision(decision)).toMatchObject({ status: 'denied' });
    expect(await claimToolDecision({ ...decision, decision: 'allow' })).toBeUndefined();
  });

  test('an expired request cannot be approved and the expiry sweep denies it once', async () => {
    await park(sessionId);
    await database.execute(
      sql`update pending_confirmation set created_at = now() - interval '2 days' where tool_use_id = 'call'`,
    );
    expect(await claimToolDecision({ ...decision, decision: 'allow' })).toBeUndefined();
    expect(await expireToolDecisions(sessionId)).toMatchObject([{ status: 'denied' }]);
    expect(await expireToolDecisions(sessionId)).toEqual([]);
    expect(await claimToolDecision({ ...decision, decision: 'allow' })).toBeUndefined();
  });

  test('a denial is stored with the decision, so a failed send is retried and posted once', async () => {
    await park(sessionId);
    failPost = true;
    expect(await confirmPendingTools({ grant, decisions: [decision] })).toMatchObject([
      { status: 'skipped' },
    ]);
    expect(await dispatchRow()).toMatchObject([
      { status: 'ready', delivery: { content: { code: 'USER_DENIED' } } },
    ]);
    failPost = false;
    expect(await confirmPendingTools({ grant, decisions: [decision] })).toMatchObject([
      { status: 'resolved' },
    ]);
    expect(posts).toHaveLength(1);
  });

  test('approving an old parked call takes over execution instead of reporting it interrupted', async () => {
    await claimAnthropicCustomToolCalls(
      sessionId,
      [{ toolUseId: 'call', name: 'delete_library_item' }],
      [parkedCall],
    );
    await ageDispatch('1 hour');
    await claimToolDecision({ ...decision, decision: 'allow' });
    expect(await recoverToolDelivery(context, 'call')).toMatchObject({
      status: 'retry',
      detail: 'EXECUTING',
    });
    expect(posts).toEqual([]);
  });

  test('a call waiting for a decision past the execution lease is never answered as interrupted', async () => {
    await claimAnthropicCustomToolCalls(
      sessionId,
      [{ toolUseId: 'call', name: 'delete_library_item' }],
      [parkedCall],
    );
    await ageDispatch('1 hour');

    expect(await recoverToolDelivery(context, 'call')).toMatchObject({ status: 'pending' });
    await reconcileToolDeliveries();

    expect(await dispatchRow()).toEqual([{ status: 'awaiting_decision', delivery: null }]);
    expect(posts).toEqual([]);
  });

  test('one result whose delivery check fails does not stop the approval cards from loading', async () => {
    await park(sessionId);
    await readyResult('bad');
    await readyResult('good');
    vi.mocked(anthropicEventPoster.isToolResultDelivered).mockImplementation(
      async (_session, call) => {
        if (call.toolUseId === 'bad') throw new Error('upstream lookup failed');
        return false;
      },
    );

    expect(await listPendingConfirmations(sessionId)).toMatchObject([{ toolUseId: 'call' }]);
    expect(posts).toEqual([expect.objectContaining({ toolUseId: 'good' })]);
  });
});

describe('stored results', () => {
  test('a delivered result refuses every later state write and is never posted again', async () => {
    await claimAnthropicCustomToolCalls(sessionId, [{ toolUseId: 'call', name: 'test' }], []);
    expect(
      await moveToolDelivery({
        sessionId,
        toolUseId: 'call',
        to: 'ready',
        delivery: { isError: false, content: { done: true }, source: 'tool_call' },
        staleBefore: null,
      }),
    ).toBe(true);
    await deliverStoredTool(context, 'call');
    for (const to of ['executing', 'ready', 'delivered', 'completed'] as const)
      expect(
        await moveToolDelivery({
          sessionId,
          toolUseId: 'call',
          to,
          delivery: null,
          staleBefore: null,
        }),
      ).toBe(false);
    await deliverStoredTool(context, 'call');
    expect(posts).toHaveLength(1);
  });

  test('a run interrupted past its lease gets an explicit unknown outcome and is not rerun', async () => {
    await claimAnthropicCustomToolCalls(sessionId, [{ toolUseId: 'call', name: 'test' }], []);
    await moveToolDelivery({
      sessionId,
      toolUseId: 'call',
      to: 'executing',
      delivery: null,
      staleBefore: null,
    });
    expect(await recoverToolDelivery(context, 'call')).toMatchObject({ status: 'retry' });
    await ageDispatch('6 minutes');
    expect(await recoverToolDelivery(context, 'call')).toMatchObject({
      status: 'posted',
      detail: 'EXECUTION_INTERRUPTED',
    });
    expect(posts).toHaveLength(1);
  });

  test('a successful handler is not run again after a failed send, and its billing field stays private', async () => {
    let executions = 0;
    const bound = bindTool({
      name: 'destructive_test',
      description: 'test',
      riskLevel: 'destructive',
      inputJsonSchema: { type: 'object' },
      inputSchema: z.object({}),
      outputSchema: z.object({ deleted: z.boolean(), vendorCostCents: z.number() }),
      handler: async () => {
        executions += 1;
        return { deleted: true, vendorCostCents: 42 };
      },
    });
    const prepared = bound.prepare({});
    if (!prepared.success) throw prepared.error;
    const ctx = { ...context, workspaceId, userId: 'owner', actorUserId: 'owner' };
    await claimAnthropicCustomToolCalls(sessionId, [{ toolUseId: 'call', name: bound.name }], []);
    failPost = true;
    await expect(runAndPost(bound, prepared.data, 'call', ctx)).rejects.toThrow('send failed');
    failPost = false;
    expect(await runAndPost(bound, prepared.data, 'call', ctx)).toMatchObject({
      status: 'posted',
    });
    expect(executions).toBe(1);
    expect(posts).toEqual([expect.objectContaining({ content: { deleted: true } })]);
  });

  test.each([
    { delivered: true, posted: 0, status: 'completed' },
    { delivered: false, posted: 1, status: 'completed' },
    { delivered: 'unavailable', posted: 0, status: 'abandoned' },
  ] as const)('upstream says delivered=$delivered: posts $posted and ends $status', async ({
    delivered,
    posted,
    status,
  }) => {
    await readyResult();
    vi.mocked(anthropicEventPoster.isToolResultDelivered).mockResolvedValue(delivered);
    expect(await deliverStoredTool(context, 'call')).toMatchObject({ status: 'posted' });
    expect(posts).toHaveLength(posted);
    expect(await dispatchRow()).toEqual([{ status, delivery: null }]);
  });

  test('two concurrent senders of one stored result post it once', async () => {
    await readyResult();
    await Promise.all([deliverStoredTool(context, 'call'), deliverStoredTool(context, 'call')]);
    expect(posts).toHaveLength(1);
  });
});

describe('billing stored vendor cost', () => {
  test('a result Anthropic can no longer take still bills its vendor cost once', async () => {
    await readyResult('call', 42);
    vi.mocked(anthropicEventPoster.isToolResultDelivered).mockResolvedValue('unavailable');
    await deliverStoredTool(context, 'call');
    await deliverStoredTool(context, 'call');
    expect(
      (
        await database.execute(
          sql`select vendor_cost_cents from usage_event where usage_key = 'tool:call'`,
        )
      ).rows,
    ).toEqual([{ vendor_cost_cents: '42.000000' }]);
    expect(await dispatchRow()).toEqual([{ status: 'abandoned', delivery: null }]);
    expect(posts).toEqual([]);
  });

  test('a failed billing write keeps the cost on the record so recovery bills it', async () => {
    await readyResult('call', 42);
    vi.mocked(anthropicEventPoster.isToolResultDelivered).mockResolvedValue('unavailable');
    await database.execute(
      sql`create function reject_tool_usage() returns trigger language plpgsql as $$ begin raise exception 'billing failed'; end $$`,
    );
    await database.execute(
      sql`create trigger reject_tool_usage before insert on usage_event for each row execute function reject_tool_usage()`,
    );
    try {
      await expect(deliverStoredTool(context, 'call')).rejects.toBeDefined();
      expect(await dispatchRow()).toMatchObject([
        { status: 'ready', delivery: { vendorCostCents: 42 } },
      ]);
    } finally {
      await database.execute(sql`drop trigger reject_tool_usage on usage_event`);
      await database.execute(sql`drop function reject_tool_usage()`);
    }
    await recoverToolDelivery(context, 'call');
    expect(await dispatchRow()).toEqual([{ status: 'abandoned', delivery: null }]);
  });

  test('a record that cannot be billed moves to the back so it does not block recovery of others', async () => {
    await database.execute(sql`insert into custom_tool_dispatch (session_id, tool_use_id, tool_name, status, delivery, updated_at)
      values (${sessionId}, 'broken-billing', 'search', 'delivered', '{"isError":false,"content":{},"source":"tool_call","vendorCostCents":-1}'::jsonb, now() - interval '1 hour')`);
    const started = new Date();
    await expect(reconcileToolDeliveries()).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
    const record = await database.execute<{ updated_at: Date; status: string }>(
      sql`select updated_at, status from custom_tool_dispatch where tool_use_id = 'broken-billing'`,
    );
    expect(record.rows[0]?.status).toBe('delivered');
    expect(new Date(record.rows[0]?.updated_at ?? 0).getTime()).toBeGreaterThanOrEqual(
      started.getTime(),
    );
    await expect(reconcileToolDeliveries()).resolves.toBeUndefined();
  });
});

// The save-output tool imports a session file into the Library through this claim.
test('two imports of one output keep the first Library file and trash the loser', async () => {
  const artifactId = randomUUID();
  const firstFile = randomUUID();
  const secondFile = randomUUID();
  for (const id of [firstFile, secondFile])
    await database.execute(
      sql`insert into file (id, workspace_id, created_by_user_id, source, storage_path, folder_path, filename, mime_type, size_bytes) values (${id}, ${workspaceId}, 'owner', 'session_output', ${id}, '/', 'source.png', 'image/png', 1)`,
    );
  await database.execute(
    sql`insert into artifact (id, workspace_id, session_id, anthropic_file_id, filename, mime_type, size_bytes, file_created_at) values (${artifactId}, ${workspaceId}, ${sessionId}, 'artifact', 'source.png', 'image/png', 1, now())`,
  );
  const save = { artifactId, userId: 'owner' };
  expect((await claimArtifactSave({ ...save, fileId: firstFile }))?.fileId).toBe(firstFile);
  expect((await claimArtifactSave({ ...save, fileId: secondFile }))?.fileId).toBe(firstFile);
  await discardImportedFile(secondFile);
  const linked = await database.execute(
    sql`select file_id from artifact_save where artifact_id = ${artifactId}`,
  );
  expect(linked.rows).toEqual([{ file_id: firstFile }]);
  const loser = await database.execute(sql`select deleted_at from file where id = ${secondFile}`);
  expect(loser.rows).toEqual([]);
});
