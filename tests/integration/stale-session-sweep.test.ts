/** Healing chats whose live stream was lost: the stale sweep, its cooldown and the relay's stall check, on real Postgres with Anthropic faked. */
import assert from 'node:assert/strict';
import { APIError } from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { session } from '@/db/schema';
import {
  isStreamStalled,
  STALL_GRACE_MS,
  type StallProbeClient,
} from '@/features/sessions/api/stream-stall';
import { applyMigrations, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

// Notifications, realtime and the browser sweep are real; they are read back as rows.
const fakes = vi.hoisted(() => ({
  archive: vi.fn(async () => {}),
  retrieve: vi.fn(async () => ({ status: 'running' })),
  send: vi.fn(async () => {}),
  candidates: vi.fn<() => AsyncIterable<Record<string, unknown>>>(),
  captureException: vi.fn<(error: unknown, context?: Record<string, unknown>) => void>(),
  listImpl:
    vi.fn<(id?: string, params?: { types?: string[] }) => AsyncIterable<Record<string, unknown>>>(),
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock('@/lib/observability', () => ({ captureException: fakes.captureException }));
vi.mock('@/features/agents', () => {
  const client = {
    beta: {
      sessions: {
        archive: fakes.archive,
        list: () => fakes.candidates(),
        retrieve: fakes.retrieve,
        events: {
          send: fakes.send,
          list: (id: string, params: { types?: string[] }) => fakes.listImpl(id, params),
        },
      },
    },
  };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    fakes.afterCallbacks.push(fn);
  },
}));

const stale = await import('@/features/session-runtime/api/reconcile-stale-sessions');
const statusSync = await import('@/features/sessions/api/sync-session-status');
const creation = await import('@/features/session-runtime/api/reconcile-session-creation');
const { hideSessionTransition } = await import('@/features/sessions/api/session-transitions');
const { dispatchSessionActions } = await import('@/features/tools/api/dispatch-session-actions');
const { withRequestContext } = await import('@/lib/request-context');

// Sweeps run inside the request or job context their trigger opens.
function inJob<A extends unknown[], R>(entry: (...args: A) => Promise<R>) {
  return (...args: A) => withRequestContext({ route: 'test' }, () => entry(...args));
}
const reconcileAll = () => inJob(stale.reconcileAllSessions)(dispatchSessionActions);
const reconcileWorkspaceSessions = inJob(stale.reconcileWorkspaceSessions);
const reconcileSessionCreation = inJob(creation.reconcileSessionCreation);
const sync = (anthropicSessionId: string, allowFromPause = false) =>
  inJob(statusSync.syncSessionStatus)({ kind: 'reconcile', anthropicSessionId, allowFromPause });

/**
 * Each sweep catches its own provider failures, so only an infrastructure failure (the database
 * going away) makes one throw a non-durable error. That cannot be produced against a live test
 * database, so this stands the browser sweep in for it, scoped to the next fresh import.
 */
function failNextBrowserSweep(): void {
  // eslint-disable-next-line no-restricted-syntax -- only a database outage makes a sweep throw a non-durable error, which a live test database cannot produce
  vi.doMock('@/features/tools/api/browser-timeout', () => ({
    reconcileTimedOutBrowserSessions: async () => {
      throw new Error('database unavailable');
    },
  }));
}

async function* emptyEvents(): AsyncGenerator<Record<string, unknown>> {
  // A ghost session: upstream exists but has never emitted a single event.
}
const emptyHistory = () => Object.assign(emptyEvents(), { data: [] });
function history(...events: Array<Record<string, unknown>>) {
  return () =>
    (async function* () {
      yield* events;
    })();
}
const idleEvent = (id: string, at = new Date().toISOString()) => ({
  id,
  type: 'session.status_idle',
  processed_at: at,
  stop_reason: { type: 'end_turn' },
});
const providerError = (status: number) => () => {
  throw new APIError(status, {}, 'provider error', new Headers());
};

const pool = makeTestPool();
const db = makeTestDb(pool);
let workspaceId: string;
beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  vi.clearAllMocks();
  fakes.retrieve.mockReset().mockResolvedValue({ status: 'running' });
  fakes.archive.mockReset().mockResolvedValue(undefined);
  fakes.send.mockReset().mockResolvedValue(undefined);
  fakes.candidates.mockReset();
  fakes.listImpl.mockReset().mockImplementation(emptyHistory);
  fakes.afterCallbacks.length = 0;
  vi.doUnmock('@/features/tools/api/browser-timeout');
  await db.execute(
    sql`insert into "user" (id,name,email,email_verified,created_at,updated_at) values ('user_1','user','user_1@example.test',true,now(),now())`,
  );
  await db.execute(
    sql`insert into organization (id,name,slug,created_at) values ('org_1','org','org_1',now())`,
  );
  await db.execute(
    sql`insert into member (id,organization_id,user_id,role,created_at) values ('member_1','org_1','user_1','owner',now())`,
  );
  await db.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id) values ('org_1', 'user_1', 'composio_user_1')`,
  );
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into workspace (organization_id, name) values ('org_1', 'ws') returning id`,
  );
  assert.ok(rows[0]);
  workspaceId = rows[0].id;
});

/** A running chat whose last event is ten minutes old, then any column changes the case needs. */
async function seedStale(
  anthropicSessionId: string,
  changes: Record<string, unknown> = {},
): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, anthropic_session_id, status, last_event_at)
        values ('read_write', ${workspaceId}, 'default', 'user_1', 'chat', ${anthropicSessionId}, 'running', now() - interval '10 minutes')
        returning id`,
  );
  const id = rows[0]?.id;
  assert.ok(id);
  if (Object.keys(changes).length > 0) {
    await db.update(session).set(changes).where(eq(session.id, id));
  }
  return id;
}
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/** Sessions the sweep has no reason to probe first, inserted in one statement. */
function seedBacklog(prefix: string, count: number, status: 'idle' | 'creation_cleanup') {
  return db.execute(sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, anthropic_session_id, status, last_event_at, status_changed_at)
    select 'read_write', ${workspaceId}, 'default', 'user_1', 'chat', ${prefix} || n, ${status},
      case when ${status} = 'idle' then now() - interval '90 days' else now() - interval '10 minutes' end,
      now() - interval '3 minutes' + make_interval(secs => n * 0.001)
    from generate_series(0, ${count - 1}) n`);
}

async function statusOf(anthropicSessionId: string): Promise<string> {
  const { rows } = await db.execute<{ status: string }>(
    sql`select status from session where anthropic_session_id = ${anthropicSessionId}`,
  );
  assert.ok(rows[0]);
  return rows[0].status;
}

async function notifications() {
  const { rows } = await db.execute<{ kind: string; idempotency_key: string | null }>(
    sql`select kind, idempotency_key from notification order by created_at`,
  );
  return rows;
}

async function statusPublishes(): Promise<number> {
  const { rows } = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from realtime_event where type = 'session_status'`,
  );
  return rows.at(0)?.count ?? 0;
}

describe('healing a stale chat from provider history', () => {
  test('a provider with no status events leaves the chat as it is, unpublished and unnotified', async () => {
    await seedStale('sesn_ghost');
    await reconcileAll();
    expect(await statusOf('sesn_ghost')).toBe('running');
    expect(await statusPublishes()).toBe(0);
    expect(await notifications()).toEqual([]);
  });

  test.each([
    'running',
    'idle',
  ] as const)('a %s chat missing upstream (404) ends without a completion notice', async (status) => {
    await seedStale(`missing_${status}`, { status });
    fakes.listImpl.mockImplementation(providerError(404));
    await reconcileAll();
    expect(await statusOf(`missing_${status}`)).toBe('terminated');
    expect(await notifications()).toEqual([]);
  });

  test('a real finish upstream notifies once, keyed to the provider event, even on replay', async () => {
    await seedStale('sesn_real');
    fakes.listImpl.mockImplementation(history(idleEvent('sevt_real_idle')));
    await reconcileAll();
    expect(await statusOf('sesn_real')).toBe('idle');
    await sync('sesn_real');
    expect(await statusPublishes()).toBe(1);
    expect(await notifications()).toEqual([
      { kind: 'task.completed', idempotency_key: 'task.completed:sevt_real_idle' },
    ]);
  });

  test('two observers of the same finish both report it and publish it once', async () => {
    await seedStale('race');
    let reads = 0;
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const at = new Date().toISOString();
    fakes.listImpl.mockImplementation(() =>
      (async function* () {
        reads += 1;
        if (reads === 2) release();
        await barrier;
        yield idleEvent('idle_race', at);
      })(),
    );
    expect(await Promise.all([sync('race'), sync('race')])).toEqual([
      { status: 'idle', stopReason: 'end_turn' },
      { status: 'idle', stopReason: 'end_turn' },
    ]);
    expect(await statusPublishes()).toBe(1);
  });

  test('a late running event never undoes a newer finish', async () => {
    await seedStale('sesn_late');
    fakes.listImpl.mockImplementation(
      history(idleEvent('latest'), {
        id: 'earlier',
        type: 'session.status_running',
        processed_at: new Date(0).toISOString(),
      }),
    );
    await sync('sesn_late');
    expect(await statusOf('sesn_late')).toBe('idle');
  });

  test('a stop by the user is recorded as interrupted, without a completion notice', async () => {
    await seedStale('sesn_interrupted');
    fakes.listImpl.mockImplementation(
      history(idleEvent('idle'), {
        id: 'interrupt',
        type: 'user.interrupt',
        processed_at: new Date().toISOString(),
      }),
    );
    await sync('sesn_interrupted');
    const { rows } = await db.execute(
      sql`select stop_reason from session where anthropic_session_id = 'sesn_interrupted'`,
    );
    expect(rows).toEqual([{ stop_reason: 'interrupted' }]);
    expect(await notifications()).toEqual([]);
  });

  test('a provider that ended the chat closes a resume in flight and clears the pause', async () => {
    await seedStale('sesn_terminated', {
      status: 'resuming',
      pausedAt: new Date(),
      pausedReason: 'credits',
    });
    fakes.listImpl.mockImplementation(
      history({
        id: 'terminal',
        type: 'session.status_terminated',
        processed_at: new Date().toISOString(),
      }),
    );
    await sync('sesn_terminated', true);
    expect(await statusOf('sesn_terminated')).toBe('terminated');
    const { rows } = await db.execute(
      sql`select paused_at, paused_reason from session where anthropic_session_id = 'sesn_terminated'`,
    );
    expect(rows).toEqual([{ paused_at: null, paused_reason: null }]);
  });

  test('a provider validation error (400) keeps the live chat for the next sweep', async () => {
    await seedStale('read_400');
    fakes.listImpl.mockImplementation(providerError(400));
    await expect(reconcileAll()).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
    expect(await statusOf('read_400')).toBe('running');
  });

  test('a failed status read records a probe so the next sweep does not hammer the provider', async () => {
    const id = await seedStale('failed_history', { status: 'idle' });
    fakes.listImpl.mockImplementation(() => {
      throw new Error('history unavailable');
    });
    await expect(reconcileAll()).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
    await reconcileAll();
    expect(fakes.listImpl).toHaveBeenCalledTimes(1);
    const { rows } = await db.execute(
      sql`select last_status_probe_at from session where id = ${id}`,
    );
    expect(rows.at(0)?.last_status_probe_at).not.toBeNull();
  });

  test('a deleted chat that is still live upstream is archived there by the sweep', async () => {
    fakes.retrieve.mockResolvedValueOnce({ status: 'idle' });
    const id = await seedStale('sesn_hidden');
    await hideSessionTransition(db, eq(session.id, id));
    await reconcileAll();
    expect(fakes.archive).toHaveBeenCalledWith('sesn_hidden');
    expect(await statusOf('sesn_hidden')).toBe('terminated');
    const { rows } = await db.execute(
      sql`select provider_archived_at from session where id = ${id}`,
    );
    expect(rows.at(0)?.provider_archived_at).not.toBeNull();
  });
});

describe('credit pauses', () => {
  test('a pause notice goes out once, keyed to the pause episode', async () => {
    const at = new Date('2026-11-01T00:00:00Z');
    const id = await seedStale('pause_notice', {
      status: 'pausing',
      pausedAt: at,
      pausedReason: 'credits',
      statusChangedAt: minutesAgo(3),
    });
    await reconcileAll();
    expect(await notifications()).toEqual([
      { kind: 'credits.paused', idempotency_key: `credits-paused:${id}:${at.toISOString()}` },
    ]);
  });

  test.each([
    ['a recent pause gets its missing notice', 0, ['credits.paused']],
    ['a two-day-old pause gets no new notice', 2 * 24 * 60, []],
  ])('%s', async (_case, pausedMinutesAgo, kinds) => {
    await seedStale(`pause_${pausedMinutesAgo}`, {
      status: 'paused_no_credits',
      pausedAt: minutesAgo(pausedMinutesAgo),
      pausedReason: 'credits',
    });
    fakes.retrieve.mockResolvedValueOnce({ status: 'idle' });
    await reconcileAll();
    expect((await notifications()).map((row) => row.kind)).toEqual(kinds);
  });

  test('a provider 400 on the interrupt keeps a paused chat paused', async () => {
    await seedStale('interrupt_400', {
      status: 'paused_no_credits',
      pausedAt: new Date(),
      pausedReason: 'credits',
    });
    fakes.send.mockRejectedValueOnce(new APIError(400, {}, 'tool result required', new Headers()));
    await expect(reconcileAll()).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
    expect(await statusOf('interrupt_400')).toBe('paused_no_credits');
  });

  test('recovery skips its interrupt when a resume claims the chat during the provider read', async () => {
    const id = await seedStale('resume_race', {
      status: 'paused_no_credits',
      pausedAt: new Date(),
      pausedReason: 'credits',
    });
    fakes.retrieve.mockImplementationOnce(async () => {
      await db.execute(
        sql`update session set status = 'resuming', state_version = state_version + 1 where id = ${id}`,
      );
      return { status: 'running' };
    });
    await reconcileAll();
    expect(fakes.send).not.toHaveBeenCalled();
    expect(await statusOf('resume_race')).toBe('resuming');
  });
});

describe('what the sweep probes first', () => {
  test('expired claims and running chats are probed ahead of an old idle backlog', async () => {
    await seedBacklog('backlog_', 26, 'idle');
    await seedStale('priority_claim', {
      status: 'pausing',
      pausedAt: new Date(),
      pausedReason: 'credits',
      statusChangedAt: minutesAgo(3),
      lastStatusProbeAt: minutesAgo(10),
    });
    await seedStale('priority_running', { lastStatusProbeAt: minutesAgo(10) });
    await reconcileAll();
    expect(await statusOf('priority_claim')).toBe('paused_no_credits');
    expect(fakes.listImpl).toHaveBeenCalledWith('priority_running', expect.anything());
  });

  test('old idle, waiting and paused chats stop costing provider probes', async () => {
    await seedStale('inserted_run', {
      status: 'idle',
      kind: 'task_run',
      stateVersion: 0,
      lastEventAt: minutesAgo(3 * 24 * 60),
    });
    await seedStale('expired_waiting', {
      status: 'awaiting_opening',
      statusChangedAt: minutesAgo(2 * 24 * 60),
    });
    await seedStale('expired_paused', {
      status: 'paused_no_credits',
      statusChangedAt: minutesAgo(2 * 24 * 60),
      pausedAt: new Date(0),
      pausedReason: 'credits',
    });
    await reconcileAll();
    expect(fakes.retrieve).not.toHaveBeenCalled();
    expect(fakes.listImpl).not.toHaveBeenCalled();
    expect(await statusOf('inserted_run')).toBe('idle');
  });
});

describe('chats whose creation did not finish', () => {
  const stuck = { status: 'creation_cleanup' as const, statusChangedAt: minutesAgo(3) };

  test('a failed cleanup does not stop another stale chat from healing', async () => {
    await seedStale('cleanup_failure', stuck);
    await seedStale('healthy_after_cleanup');
    fakes.retrieve.mockResolvedValue({ status: 'idle' });
    fakes.archive.mockRejectedValueOnce(new Error('archive failed'));
    fakes.listImpl.mockImplementation(history(idleEvent('idle_healthy')));
    await expect(reconcileAll()).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
    expect(await statusOf('healthy_after_cleanup')).toBe('idle');
  });

  test('a running half-created chat is interrupted before it is archived', async () => {
    await seedStale('cleanup_running', stuck);
    await reconcileAll();
    expect(fakes.send).toHaveBeenCalled();
    expect(fakes.archive).not.toHaveBeenCalled();
    expect(await statusOf('cleanup_running')).toBe('creation_cleanup');
  });

  test('a creation the provider never made (404) ends without an archive call', async () => {
    await seedStale('missing_creation', stuck);
    fakes.retrieve.mockRejectedValueOnce(new APIError(404, {}, 'missing', new Headers()));
    await reconcileAll();
    expect(await statusOf('missing_creation')).toBe('terminated');
    expect(fakes.archive).not.toHaveBeenCalled();
  });

  test('discovery skips an already archived provider match and stops paging', async () => {
    const id = await seedStale('creation_match', { ...stuck, anthropicSessionId: null });
    fakes.candidates.mockImplementation(() =>
      (async function* () {
        yield {
          id: 'archived',
          archived_at: new Date().toISOString(),
          metadata: { app_session_id: id },
        };
        throw new Error('must not request another page');
      })(),
    );
    await reconcileSessionCreation('all-workspaces');
    expect(fakes.archive).not.toHaveBeenCalled();
    expect((await db.execute(sql`select status from session where id = ${id}`)).rows).toEqual([
      { status: 'terminated' },
    ]);
  });

  test('failing cleanups rotate so the one past the first batch is still tried', async () => {
    await seedBacklog('failed_creation_', 26, 'creation_cleanup');
    fakes.retrieve.mockRejectedValue(new Error('provider offline'));
    await expect(reconcileSessionCreation('all-workspaces')).rejects.toMatchObject({
      code: 'EXTERNAL_API_FAILED',
    });
    await expect(reconcileSessionCreation('all-workspaces')).rejects.toMatchObject({
      code: 'EXTERNAL_API_FAILED',
    });
    expect(fakes.retrieve).toHaveBeenCalledWith('failed_creation_25', {}, expect.anything());
  });

  test("a workspace's own reconcile never touches another workspace's stuck creation", async () => {
    await seedStale('own_workspace');
    await db.execute(
      sql`insert into organization (id,name,slug,created_at) values ('org_2','other','org_2',now())`,
    );
    const { rows } = await db.execute<{ id: string }>(sql`with other as (
        insert into workspace (organization_id, name) values ('org_2', 'other') returning id
      )
      insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, anthropic_session_id, status, status_changed_at)
      select 'read_write', id, 'default', 'user_1', 'chat', 'other_creation', 'creation_cleanup', now() - interval '3 minutes' from other
      returning id`);
    await reconcileWorkspaceSessions({
      workspaceId,
      dispatchPendingToolCalls: dispatchSessionActions,
    });
    expect(fakes.retrieve).not.toHaveBeenCalledWith('other_creation', {}, expect.anything());
    expect(
      (await db.execute(sql`select status from session where id = ${rows[0]?.id}`)).rows,
    ).toEqual([{ status: 'creation_cleanup' }]);
  });
});

describe('the sweep cooldown', () => {
  // Fresh module per test: the cooldown lives in module state.
  async function freshSchedule() {
    vi.resetModules();
    const mod = await import('@/features/jobs/api/recovery-sweeps');
    const { withRequestContext: inFreshContext } = await import('@/lib/request-context');
    return () => inFreshContext({ route: 'test' }, () => mod.scheduleStaleSessionSweep());
  }

  test.each([
    { browserFails: false, taskFails: false, retriesAtOnce: false },
    { browserFails: true, taskFails: false, retriesAtOnce: true },
    { browserFails: false, taskFails: true, retriesAtOnce: false },
    { browserFails: true, taskFails: true, retriesAtOnce: true },
  ])('browser sweep fails $browserFails, task row fails $taskFails: the next trigger runs at once $retriesAtOnce', async ({
    browserFails,
    taskFails,
    retriesAtOnce,
  }) => {
    if (taskFails) {
      const sessionId = await seedStale('task-owner', { status: 'idle' });
      // This provider has no deployments endpoint, so task-row recovery fails durably.
      await db.execute(sql`insert into task (workspace_id, created_by_user_id, title, status,
        provider_sync, trigger_type, cron_schedule, anthropic_deployment_id, updated_at)
        select workspace_id, created_by_user_id, 'Pending pause', 'paused', 'status',
          'schedule', '0 9 * * *', 'missing-provider', now() - interval '10 minutes'
        from session where id = ${sessionId}`);
    }
    if (browserFails) failNextBrowserSweep();
    const schedule = await freshSchedule();
    schedule();
    expect(fakes.afterCallbacks).toHaveLength(1);
    await fakes.afterCallbacks[0]?.();
    if (browserFails) {
      expect(fakes.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ op: 'stale-session-sweep' }),
      );
    }
    if (taskFails) expect(fakes.captureException).toHaveBeenCalled();
    schedule();
    expect(fakes.afterCallbacks).toHaveLength(retriesAtOnce ? 2 : 1);
  });
});

test.each([
  ['an undelivered event older than the grace window', 'old', new Set(['sevt_old']), true],
  ['a delivered newest event', 'old', new Set(['sevt_new']), false],
  ['an undelivered event inside the grace window', 'fresh', new Set<string>(), false],
  ['an event without a timestamp', null, new Set<string>(), false],
  ['an empty history', 'none', new Set<string>(), false],
] as const)('the relay counts %s as a stall: %s', async (_case, age, seen, stalled) => {
  const processedAt =
    age === 'old'
      ? new Date(Date.now() - STALL_GRACE_MS - 5_000).toISOString()
      : age === 'fresh'
        ? new Date(Date.now() - 1_000).toISOString()
        : null;
  const options: { timeout?: number } = {};
  const client: StallProbeClient = {
    beta: {
      sessions: {
        events: {
          list: async (_sessionId, _params, requestOptions) => {
            options.timeout = requestOptions.timeout;
            return { data: age === 'none' ? [] : [{ id: 'sevt_new', processed_at: processedAt }] };
          },
        },
      },
    },
  };
  await expect(isStreamStalled(client, 'sesn_1', seen)).resolves.toBe(stalled);
  // The probe never waits the SDK's ten-minute default.
  if (age !== 'none') expect(options.timeout).toBeLessThanOrEqual(30_000);
});
