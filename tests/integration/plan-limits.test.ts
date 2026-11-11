// Plan limits on chats at once and scheduled tasks: the counts, the races, and every entry point that opens one.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { seedCreditBalance } from './helpers/billing-ledger';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const fakes = vi.hoisted(() => ({
  sessionCreates: 0,
  deploymentCreates: 0,
  // What the provider says each session is doing, for stale-status reconciliation.
  upstreamStatus: new Map<string, 'idle' | 'running'>(),
  unpause: vi.fn(),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => ({
    userId: 'user_plan',
    organizationId: 'org_plan',
  })),
);
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    ANTHROPIC_AGENT_ID_DEFAULT: 'agent_1',
    ANTHROPIC_ENVIRONMENT_ID: 'environment_1',
  }),
);
// The real module keeps the agent and environment id resolvers; only the client is replaced.
vi.mock('@/features/agents/api/anthropic-client', async (actual) => {
  const client = () => ({
    beta: {
      agents: {
        retrieve: async () => ({ id: 'agent_1', version: 1 }),
        update: async () => ({ id: 'agent_1', version: 2 }),
      },
      sessions: {
        create: async () => {
          fakes.sessionCreates += 1;
          return { id: `upstream_session_${fakes.sessionCreates}` };
        },
        archive: async () => undefined,
        events: {
          send: async () => ({ data: [] }),
          list: (sessionId: string) => ({
            async *[Symbol.asyncIterator]() {
              const status = fakes.upstreamStatus.get(sessionId);
              if (!status) return;
              yield {
                id: `event_${sessionId}_${status}`,
                type: `session.status_${status}`,
                processed_at: new Date().toISOString(),
                ...(status === 'idle' ? { stop_reason: { type: 'end_turn' } } : {}),
              };
            },
          }),
        },
      },
      deployments: {
        create: async () => {
          fakes.deploymentCreates += 1;
          return {
            id: `deployment_${fakes.deploymentCreates}`,
            schedule: { upcoming_runs_at: [new Date(Date.now() + 7 * 86_400_000).toISOString()] },
          };
        },
        retrieve: async () => ({ status: 'active', archived_at: null, schedule: null }),
        unpause: fakes.unpause,
      },
    },
  });
  return {
    ...(await actual<typeof import('@/features/agents/api/anthropic-client')>()),
    getAnthropicClient: client,
    requireAnthropicClient: client,
  };
});

const { db: appDb } = await import('@/db');
const { session: sessionTable } = await import('@/db/schema');
const { assertCanStartChat } = await import('@/features/billing/api/assert-plan-limits');
const { CREDITS_ONLY_RULES } = await import('@/features/billing/credits-only/rules');
const { PLANS } = await import('@/features/billing/pricing-config');
const { startMemoryUpdateTask } = await import('@/features/chat/api/memory-update-task');
const { askAgentToUpdateMemory } = await import('@/features/chat/api/memory-update-actions');
const { newTaskWithFiles } = await import('@/features/chat/api/new-task-with-files');
const { reconcileWorkspaceSessions } = await import(
  '@/features/session-runtime/api/reconcile-stale-sessions'
);
const { sessionRouteErrorResponse } = await import('@/features/sessions/api/session-access');
const { assertCanCreateScheduledTask } = await import('@/features/tasks/api/assert-schedule-limit');
const { createTask } = await import('@/features/tasks/api/create-task');
const { resumeTask } = await import('@/features/tasks/api/task-lifecycle');
const { updateTask } = await import('@/features/tasks/api/update-task');
const { dispatchSessionActions } = await import('@/features/tools/api/dispatch-session-actions');
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_plan';
const USER = 'user_plan';
const CHATS = PLANS.pro.limits.chatsAtOnce;
const TASKS = PLANS.pro.limits.scheduledTasks;

let workspaceId: string;

beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  fakes.sessionCreates = 0;
  fakes.upstreamStatus.clear();
  fakes.unpause.mockReset();
  await seedUser(db, USER);
  workspaceId = await seedWorkspace(ORG, 'pro');
});

const inContext = <T>(run: () => Promise<T>) => withRequestContext({ route: 'test/plan' }, run);

async function seedWorkspace(organizationId: string, plan: 'none' | 'pro'): Promise<string> {
  await seedOrganization(db, organizationId);
  const pro = plan === 'pro';
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into workspace (organization_id, name, plan_tier, plan_billing_interval, stripe_subscription_id, plan_credits)
        values (${organizationId}, 'ws', ${plan}, ${pro ? 'month' : null}, ${pro ? `sub_${organizationId}` : null},
                ${pro ? 1000 : null}) returning id`,
  );
  return requiredRow(rows.at(0)).id;
}

async function seedChats(wsId: string, status: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1)
    await db.execute(
      sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, status)
          values ('read_write', ${wsId}, 'default', ${USER}, 'chat', ${status})`,
    );
}

async function seedTasks(
  wsId: string,
  triggerType: 'schedule' | 'event',
  status: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i += 1)
    await db.execute(
      sql`insert into task (workspace_id, created_by_user_id, tier, title, description, trigger_type, cron_schedule, status, timezone)
          values (${wsId}, ${USER}, 'default', 'digest', 'send it', ${triggerType},
                  ${triggerType === 'schedule' ? '0 9 * * 1' : null}, ${status}, 'UTC')`,
    );
}

const canStartChat = (wsId: string) => db.transaction((tx) => assertCanStartChat(wsId, tx));
const canSchedule = (wsId: string) =>
  db.transaction((tx) => assertCanCreateScheduledTask(wsId, USER, tx));

async function chatRows(): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from session where workspace_id = ${workspaceId} and kind = 'chat'`,
  );
  return requiredRow(rows.at(0)).n;
}

describe('the counts the gates decide on', () => {
  test.each([
    { plan: 'pro' as const, chats: CHATS, tasks: TASKS },
    {
      plan: 'none' as const,
      chats: CREDITS_ONLY_RULES.noPlanLimits.chatsAtOnce,
      tasks: CREDITS_ONLY_RULES.noPlanLimits.scheduledTasks,
    },
  ])('a $plan workspace may run $chats chats and schedule $tasks tasks, and not one more', async ({
    plan,
    chats,
    tasks,
  }) => {
    const wsId = await seedWorkspace(`org_${plan}_limits`, plan);
    await seedChats(wsId, 'running', chats - 1);
    await seedTasks(wsId, 'schedule', 'upcoming', tasks - 1);
    await expect(canStartChat(wsId)).resolves.toBeUndefined();
    await expect(canSchedule(wsId)).resolves.toBeUndefined();

    await seedChats(wsId, 'running', 1);
    await seedTasks(wsId, 'schedule', 'upcoming', 1);
    await expect(canStartChat(wsId)).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    await expect(canSchedule(wsId)).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });

  test('finished chats, removed tasks and another workspace hold no slot', async () => {
    const otherId = await seedWorkspace('org_other', 'pro');
    await seedChats(workspaceId, 'idle', 5);
    await seedChats(workspaceId, 'terminated', 5);
    await seedChats(otherId, 'running', 5);
    // Deleting a task marks it removed; counting those would make the refusal's advice a lie.
    await seedTasks(workspaceId, 'schedule', 'removed', 20);
    await seedTasks(workspaceId, 'event', 'removed', 20);
    await seedTasks(otherId, 'schedule', 'upcoming', 20);

    await expect(canStartChat(workspaceId)).resolves.toBeUndefined();
    await expect(canSchedule(workspaceId)).resolves.toBeUndefined();
  });

  test('event-triggered tasks share the scheduled-task slots', async () => {
    await seedTasks(workspaceId, 'event', 'upcoming', TASKS);
    await expect(canSchedule(workspaceId)).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });

  test.each([
    {
      gate: 'chat',
      fill: () => seedChats(workspaceId, 'running', CHATS),
      check: canStartChat,
      limit: CHATS,
    },
    {
      gate: 'scheduled task',
      fill: () => seedTasks(workspaceId, 'schedule', 'upcoming', TASKS),
      check: canSchedule,
      limit: TASKS,
    },
  ])('the $gate refusal reaches the client as a 402 naming the limit and no plan', async ({
    fill,
    check,
    limit,
  }) => {
    await fill();
    const error = await check(workspaceId).then(
      () => null,
      (e: unknown) => e,
    );
    const res = sessionRouteErrorResponse(error);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(body.error.message).toContain(String(limit));
    expect(body.error.message).not.toMatch(/\bplan\b|\bPro\b|\bMax\b/i);
  });
});

describe('races on the last free slot', () => {
  type Outcome = { ok: true } | { ok: false; code: string };
  async function race(attempt: () => Promise<unknown>): Promise<Outcome[]> {
    const settled = await Promise.allSettled([attempt(), attempt()]);
    return settled.map((result): Outcome => {
      if (result.status === 'fulfilled') return { ok: true };
      const reason = result.reason as { code?: string; message?: string };
      return { ok: false, code: reason?.code ?? String(reason?.message) };
    });
  }
  function expectOneWinner(outcomes: Outcome[]) {
    expect(outcomes.map((outcome) => (outcome.ok ? 'won' : outcome.code)).sort()).toEqual([
      'PLAN_LIMIT_REACHED',
      'won',
    ]);
  }
  // Races are timing-dependent, so each runs three times on a fresh workspace.
  const ROUNDS = 3;

  test('two chats opened at once on the last slot leave exactly one winner', async () => {
    // The gate and the insert share one transaction, which holds the gate's lock until commit.
    const open = (wsId: string) =>
      appDb.transaction(async (tx) => {
        await assertCanStartChat(wsId, tx);
        await tx.insert(sessionTable).values({
          workspaceMemoryAccess: 'read_write',
          workspaceId: wsId,
          tier: 'default',
          createdByUserId: USER,
          kind: 'chat',
          status: 'running',
        });
      });
    for (let round = 0; round < ROUNDS; round += 1) {
      const wsId = await seedWorkspace(`org_chat_race_${round}`, 'pro');
      await seedChats(wsId, 'running', CHATS - 1);
      expectOneWinner(await race(() => open(wsId)));
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from session where workspace_id = ${wsId} and status = 'running'`,
      );
      expect(requiredRow(rows.at(0)).n).toBe(CHATS);
    }
  });

  test('two scheduled tasks created at once on the last slot leave exactly one winner', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const organizationId = `org_task_race_${round}`;
      const wsId = await seedWorkspace(organizationId, 'pro');
      await seedTasks(wsId, 'schedule', 'upcoming', TASKS - 1);
      const create = () =>
        inContext(() =>
          createTask({
            workspaceId: wsId,
            createdByUserId: USER,
            organizationId,
            tier: 'default',
            autoApprove: false,
            notification: 'email',
            title: 'Daily digest',
            description: 'Send me the digest',
            successCriteria: null,
            triggerType: 'schedule',
            cron: '0 9 * * 1',
            timezone: 'UTC',
          }),
        );
      expectOneWinner(await race(create));
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from task where workspace_id = ${wsId}
            and trigger_type in ('schedule', 'event') and status <> 'removed'`,
      );
      expect(requiredRow(rows.at(0)).n).toBe(TASKS);
    }
  });
});

describe('every way to open a chat or resume a task runs the gate', () => {
  async function seedOwner() {
    await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
      values ('member_plan', ${ORG}, ${USER}, 'owner', now())`);
    await seedCreditBalance(db, workspaceId, 500);
  }
  async function seedLibraryFile(): Promise<string> {
    const { rows } = await db.execute<{ id: string }>(
      sql`insert into file (workspace_id, created_by_user_id, source, storage_path, filename, mime_type, size_bytes)
          values (${workspaceId}, ${USER}, 'user_upload', 'ws/x/notes.pdf', 'notes.pdf', 'application/pdf', 1234)
          returning id`,
    );
    return requiredRow(rows.at(0)).id;
  }
  const memoryContext = {
    organizationId: ORG,
    userId: USER,
    role: 'owner' as const,
    userStoreId: null,
    workspaceStoreId: null,
  };

  test('the Library "New task" action starts on the last free chat slot and is refused once the limit is reached', async () => {
    await seedOwner();
    const fileId = await seedLibraryFile();
    await seedChats(workspaceId, 'running', CHATS - 1);
    expect(await newTaskWithFiles([fileId], [], ORG)).toMatchObject({ ok: true });
    expect(fakes.sessionCreates).toBe(1);

    expect(await newTaskWithFiles([fileId], [], ORG)).toMatchObject({
      ok: false,
      code: 'PLAN_LIMIT_REACHED',
    });
    expect(fakes.sessionCreates).toBe(1);
    expect(await chatRows()).toBe(CHATS);
  });

  test('the Memory "Ask agent to update" action is refused at the chat limit before any session is made', async () => {
    await seedOwner();
    await seedChats(workspaceId, 'running', CHATS);
    await expect(
      inContext(() => startMemoryUpdateTask('you', memoryContext)),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(fakes.sessionCreates).toBe(0);
  });

  test('a Library or Memory action from a tab on another workspace is refused before any session is made', async () => {
    await seedOwner();
    await db.execute(sql`insert into workspace_member (organization_id, user_id, composio_user_id, user_memory_store_id)
      values (${ORG}, ${USER}, 'test-composio', 'store-test')`);
    expect(await newTaskWithFiles([], ['/'], 'org-stale')).toMatchObject({
      ok: false,
      code: 'WORKSPACE_CHANGED',
    });
    expect(await askAgentToUpdateMemory('you', 'org-stale')).toMatchObject({
      ok: false,
      code: 'WORKSPACE_CHANGED',
    });
    expect(fakes.sessionCreates).toBe(0);
    expect(await chatRows()).toBe(0);
  });

  test('resuming a paused task and edit-and-resume are both refused when the task slots are full', async () => {
    for (let i = 0; i < TASKS; i += 1)
      await db.execute(sql`insert into task (workspace_id, created_by_user_id, title, description, status, trigger_type, cron_schedule, anthropic_deployment_id)
        values (${workspaceId}, ${USER}, 'Task', 'Do work', 'upcoming', 'schedule', '0 9 * * *', ${`depl-${i}`})`);
    const taskId = randomUUID();
    await db.execute(sql`insert into task (id, workspace_id, created_by_user_id, title, description, status, trigger_type, cron_schedule, anthropic_deployment_id)
      values (${taskId}, ${workspaceId}, ${USER}, 'Task', 'Do work', 'paused', 'schedule', '0 9 * * *', 'depl-paused')`);

    await expect(
      inContext(() => resumeTask({ taskId, workspaceId, userId: USER })),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    await expect(
      inContext(() =>
        updateTask({
          expectedVersion: 1,
          taskId,
          workspaceId,
          userId: USER,
          organizationId: ORG,
          title: 'Edit',
          description: 'Prompt',
          paused: false,
        }),
      ),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(fakes.unpause).not.toHaveBeenCalled();
  });
});

describe('a chat the app still thinks is running', () => {
  async function seedStaleRunning(wsId: string, anthropicSessionId: string) {
    await db.execute(
      sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, anthropic_session_id, status, last_event_at)
          values ('read_write', ${wsId}, 'default', ${USER}, 'chat', ${anthropicSessionId}, 'running', now() - interval '2 minutes')`,
    );
  }
  async function statusOf(anthropicSessionId: string) {
    const { rows } = await db.execute<{ status: string }>(
      sql`select status from session where anthropic_session_id = ${anthropicSessionId}`,
    );
    return requiredRow(rows.at(0)).status;
  }

  test.each([
    { upstream: 'idle' as const, frees: true, after: 'idle' },
    { upstream: 'running' as const, frees: false, after: 'running' },
  ])('a stale chat that is $upstream upstream frees its slot: $frees', async ({
    upstream,
    frees,
    after,
  }) => {
    const wsId = await seedWorkspace('org_stale', 'none');
    await seedCreditBalance(db, wsId, 500);
    // Every slot but the last holds a chat the provider confirms is running.
    for (let index = 1; index < CREDITS_ONLY_RULES.noPlanLimits.chatsAtOnce; index += 1) {
      await seedStaleRunning(wsId, `occupied_${index}`);
      fakes.upstreamStatus.set(`occupied_${index}`, 'running');
    }
    await seedStaleRunning(wsId, 'last_slot');
    fakes.upstreamStatus.set('last_slot', upstream);

    await reconcileWorkspaceSessions({
      workspaceId: wsId,
      dispatchPendingToolCalls: dispatchSessionActions,
    });

    if (frees) await expect(canStartChat(wsId)).resolves.toBeUndefined();
    else await expect(canStartChat(wsId)).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(await statusOf('last_slot')).toBe(after);
  });
});
