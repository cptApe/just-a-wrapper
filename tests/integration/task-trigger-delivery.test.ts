// Composio event deliveries: one signed delivery starts at most one run, through redelivery, races,
// database faults and the spend gate. Real dispatcher, session creator and Postgres; only Anthropic
// and telemetry are replaced. Database faults are real Postgres triggers.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { seedCreditBalance } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const upstream = vi.hoisted(() => ({
  create: vi.fn(),
  archive: vi.fn(),
  list: vi.fn(),
  events: { send: vi.fn() },
}));
vi.mock('@/features/agents', async (actual) => ({
  ...(await actual<typeof import('@/features/agents')>()),
  getAnthropicClient: () => ({ beta: { sessions: upstream } }),
  requireAnthropicClient: () => ({ beta: { sessions: upstream } }),
}));
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    ANTHROPIC_AGENT_ID_DEFAULT: 'agent_test',
    ANTHROPIC_ENVIRONMENT_ID: 'env_test',
  }),
);
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/lib/observability', () => ({ captureException: vi.fn() }));

const { parseComposioWebhook, routeComposioEvent } = await import('@/features/webhooks/composio');
const { ComposioWebhookVerificationError, signComposioWebhook } = await import(
  '@/features/webhooks/composio-verify'
);
const { recordTriggerDelivery } = await import('@/features/tasks/api/trigger-delivery-transitions');
const { withRequestContext } = await import('@/lib/request-context');
const pool = makeTestPool();
const db = makeTestDb(pool);
const ORG = 'org_composio_delivery';
const USER = 'user_composio_delivery';
const SECRET = 'composio_test_signing_secret';
let taskId: string;
let workspaceId: string;

function deliver(deliveryId = 'delivery_one', bodyId = 'payload_event') {
  const body = JSON.stringify({
    id: bodyId,
    deliveryId: 'untrusted_body_delivery',
    metadata: { trigger_id: 'trigger_test', trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE' },
    data: { subject: 'Client update' },
  });
  const headers = signComposioWebhook(deliveryId, body, SECRET, new Date());
  return withRequestContext({ route: 'test/composio-delivery' }, () =>
    routeComposioEvent(parseComposioWebhook(body, headers, SECRET)),
  );
}

async function receipt(deliveryId = 'delivery_one') {
  const { rows } = await db.execute<{ payload: Record<string, unknown> }>(
    sql`select payload from processed_webhook_event where provider = 'composio' and event_id = ${deliveryId}`,
  );
  return rows[0]?.payload;
}

async function runs() {
  const { rows } = await db.execute<{ id: string; task_id: string | null; status: string }>(
    sql`select id, task_id, status from session where kind = 'task_run'`,
  );
  return rows;
}

beforeAll(async () => {
  await applyMigrations(db);
});
beforeEach(async () => {
  await db.execute(sql`drop trigger if exists fail_link on session`);
  await db.execute(sql`drop trigger if exists fail_receipt on processed_webhook_event`);
  await truncateAll(db);
  await seedOrganization(db, ORG);
  await seedUser(db, USER);
  workspaceId = randomUUID();
  taskId = randomUUID();
  await db.execute(
    sql`insert into workspace (id, organization_id, name) values (${workspaceId}, ${ORG}, 'Delivery test')`,
  );
  // Event runs pass the spend gate when their delivery is claimed.
  await seedCreditBalance(db, workspaceId, 1000);

  await db.execute(sql`insert into task (id, workspace_id, created_by_user_id, title, status, trigger_type, composio_trigger_id)
    values (${taskId}, ${workspaceId}, ${USER}, 'Handle client update', 'upcoming', 'event', 'trigger_test')`);
  upstream.create.mockReset().mockImplementation(async () => ({ id: `sesn_${randomUUID()}` }));
  upstream.events.send.mockReset().mockResolvedValue({ data: [] });
  upstream.archive.mockReset().mockResolvedValue({});
  upstream.list.mockReset().mockReturnValue([]);
});
afterAll(async () => {
  await pool.end();
});

test('a redelivery after the task is paused returns the first run instead of starting another', async () => {
  const first = await deliver();
  await db.execute(sql`update task set status = 'paused' where id = ${taskId}`);
  expect(await deliver()).toEqual(first);
  expect(first).toMatchObject({ handled: true });
  expect(upstream.create).toHaveBeenCalledTimes(1);
  expect(upstream.create.mock.calls.at(0)?.[1]).toMatchObject({ maxRetries: 0 });
  expect(await runs()).toEqual([expect.objectContaining({ task_id: taskId })]);
  expect(await receipt()).toMatchObject({ state: 'completed', taskId });
});

test('redeliveries while the first run is being created start no second run', async () => {
  let releaseCreate: () => void = () => {};
  let enteredCreate: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    enteredCreate = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  upstream.create.mockImplementationOnce(async () => {
    enteredCreate();
    await release;
    return { id: 'sesn_concurrent' };
  });
  const first = deliver();
  await entered;
  try {
    const repeats = await Promise.all(Array.from({ length: 6 }, () => deliver()));
    expect(repeats).toEqual(
      Array.from({ length: 6 }, () => ({ handled: false, reason: 'delivery_in_progress' })),
    );
    expect(await receipt()).toMatchObject({ state: 'creating', taskId });
    expect(upstream.create).toHaveBeenCalledTimes(1);
  } finally {
    releaseCreate();
  }
  const outcome = await first;
  expect(await deliver()).toEqual(outcome);
  expect(await runs()).toHaveLength(1);
});

test('eight copies of one delivery arriving at once start one run', async () => {
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => deliver()));
  expect(outcomes.some((outcome) => outcome.handled)).toBe(true);
  expect(upstream.create).toHaveBeenCalledTimes(1);
  expect(await runs()).toEqual([expect.objectContaining({ task_id: taskId })]);
});

test('two signed deliveries with the same body id both run, keyed by the signed id', async () => {
  await Promise.all([deliver('delivery_a'), deliver('delivery_b')]);
  expect(upstream.create).toHaveBeenCalledTimes(2);
  expect(await runs()).toHaveLength(2);
  expect(await receipt('untrusted_body_delivery')).toBeUndefined();
});

test('a burst of events starts no more runs than the live-run cap and records the rest as skipped', async () => {
  const outcomes = await Promise.all(
    Array.from({ length: 6 }, (_, index) => deliver(`burst_${index}`, `burst_body_${index}`)),
  );
  expect(outcomes.filter((outcome) => outcome.handled)).toHaveLength(3);
  expect(outcomes.filter((outcome) => !outcome.handled)).toEqual(
    Array.from({ length: 3 }, () => ({ handled: false, reason: 'run_limit' })),
  );
  expect(upstream.create).toHaveBeenCalledTimes(3);
  expect(await runs()).toHaveLength(3);
  const { rows } = await db.execute<{ state: string }>(
    sql`select payload->>'state' as state from processed_webhook_event where provider = 'composio' order by state`,
  );
  expect(rows.map((row) => row.state)).toEqual([
    'completed',
    'completed',
    'completed',
    'skipped',
    'skipped',
    'skipped',
  ]);
});

test('a signature cannot be replayed under a changed delivery id', () => {
  const body = JSON.stringify({ metadata: { trigger_id: 'trigger_test' } });
  const headers = signComposioWebhook('signed_id', body, SECRET, new Date());
  expect(() => parseComposioWebhook(body, { ...headers, 'webhook-id': 'changed' }, SECRET)).toThrow(
    ComposioWebhookVerificationError,
  );
  expect(upstream.create).not.toHaveBeenCalled();
});

test('a failed task link keeps the created run on record and redelivery repairs it without a second run', async () => {
  await db.execute(sql`create or replace function reject_delivery_link() returns trigger language plpgsql as $$
    begin raise exception 'injected task link failure'; end $$`);
  await db.execute(
    sql`create trigger fail_link before update of task_id on session for each row execute function reject_delivery_link()`,
  );
  await expect(deliver()).rejects.toThrow();
  expect(await receipt()).toMatchObject({ state: 'session_created', taskId });
  expect(await runs()).toEqual([expect.objectContaining({ task_id: taskId })]);
  await db.execute(sql`drop trigger fail_link on session`);
  // A remote completion may arrive before repair. Repair must preserve it.
  await db.execute(sql`update session set status = 'idle'`);
  expect(await deliver()).toMatchObject({ handled: true });
  expect(upstream.create).toHaveBeenCalledTimes(1);
  expect(await runs()).toEqual([expect.objectContaining({ task_id: taskId, status: 'idle' })]);
  expect(await receipt()).toMatchObject({ state: 'completed' });
});

test('a failed receipt write is retried locally without creating a second run', async () => {
  await db.execute(sql`create sequence if not exists receipt_attempt`);
  await db.execute(sql`alter sequence receipt_attempt restart with 1`);
  await db.execute(sql`create or replace function reject_first_receipt() returns trigger language plpgsql as $$
    begin if nextval('receipt_attempt') = 1 then raise exception 'injected receipt failure'; end if; return new; end $$`);
  await db.execute(
    sql`create trigger fail_receipt before update on processed_webhook_event for each row execute function reject_first_receipt()`,
  );
  await expect(deliver()).rejects.toMatchObject({ code: 'UNEXPECTED' });
  expect(await receipt()).toMatchObject({ state: 'session_created' });
  expect(await deliver()).toMatchObject({ handled: true });
  expect(upstream.create).toHaveBeenCalledTimes(1);
  expect(await runs()).toEqual([expect.objectContaining({ task_id: taskId })]);
});

test('a create that may have reached the provider is never retried', async () => {
  upstream.create.mockRejectedValueOnce(new Error('connection lost after create was sent'));
  await expect(deliver()).rejects.toMatchObject({ code: 'UNEXPECTED' });
  expect(await receipt()).toMatchObject({ state: 'ambiguous', taskId });
  expect(await deliver()).toEqual({ handled: false, reason: 'delivery_ambiguous' });
  expect(upstream.create).toHaveBeenCalledTimes(1);
});

test('a failed local run insert stops the provider run from being created', async () => {
  await db.execute(sql`create or replace function reject_delivery_link() returns trigger language plpgsql as $$
    begin raise exception 'injected ownership insert failure'; end $$`);
  await db.execute(
    sql`create trigger fail_link before insert on session for each row execute function reject_delivery_link()`,
  );
  upstream.create.mockResolvedValueOnce({ id: 'sesn_ownership_failed' });
  await expect(deliver()).rejects.toMatchObject({ code: 'UNEXPECTED' });
  expect(await receipt()).toMatchObject({
    state: 'ambiguous',
    sessionId: expect.any(String),
  });
  expect(await deliver()).toEqual({ handled: false, reason: 'delivery_ambiguous' });
  expect(await runs()).toEqual([]);
  expect(upstream.archive).not.toHaveBeenCalled();
  expect(upstream.create).not.toHaveBeenCalled();
});

test('a paused task or an unknown trigger starts no run', async () => {
  await db.execute(sql`update task set status = 'paused' where id = ${taskId}`);
  expect(await deliver()).toEqual({ handled: false, reason: 'task_not_active' });
  await db.execute(sql`update task set composio_trigger_id = null where id = ${taskId}`);
  expect(await deliver()).toEqual({ handled: false, reason: 'unknown_trigger' });
  expect(upstream.create).not.toHaveBeenCalled();
});

test('a failed delivery claim starts no run and leaves the delivery retryable', async () => {
  await db.execute(sql`create or replace function reject_claim() returns trigger language plpgsql as $$
    begin raise exception 'injected claim failure'; end $$`);
  await db.execute(
    sql`create trigger fail_receipt before insert on processed_webhook_event for each row execute function reject_claim()`,
  );
  await expect(deliver()).rejects.toThrow();
  expect(upstream.create).not.toHaveBeenCalled();
  expect(await receipt()).toBeUndefined();
  await db.execute(sql`drop trigger fail_receipt on processed_webhook_event`);
  expect(await deliver()).toMatchObject({ handled: true });
  expect(upstream.create).toHaveBeenCalledTimes(1);
});

test('when every receipt write after create fails, redelivery finds the run instead of making another', async () => {
  await db.execute(sql`create or replace function reject_receipt() returns trigger language plpgsql as $$
    begin raise exception 'injected database outage'; end $$`);
  await db.execute(
    sql`create trigger fail_receipt before update on processed_webhook_event for each row execute function reject_receipt()`,
  );
  await expect(deliver()).rejects.toMatchObject({ code: 'UNEXPECTED' });
  expect(await receipt()).toMatchObject({ state: 'creating' });
  await db.execute(sql`drop trigger fail_receipt on processed_webhook_event`);
  expect(await deliver()).toMatchObject({ handled: true });
  expect(upstream.create).toHaveBeenCalledTimes(1);
  expect(await runs()).toHaveLength(1);
});

test('an old uncertain receipt finds its provider run by the reserved app id', async () => {
  await db.execute(sql`insert into processed_webhook_event (provider, event_id, event_type, payload)
    values ('composio', 'delivery_one', 'test', ${JSON.stringify({ state: 'ambiguous', taskId, sessionId: randomUUID(), errorCode: 'MIGRATED' })}::jsonb)`);
  const stored = await receipt();
  if (typeof stored?.sessionId !== 'string') throw new Error('Missing reserved session ID');
  await db.execute(
    sql`update processed_webhook_event set processed_at = now() - interval '10 minutes'`,
  );
  upstream.list.mockReturnValue([
    {
      resources: [],
      id: 'recovered_remote',
      archived_at: null,
      metadata: { app_session_id: stored.sessionId },
      status: 'idle',
      created_at: new Date().toISOString(),
    },
  ]);
  expect(await deliver()).toMatchObject({ handled: true, sessionId: stored.sessionId });
  expect(await receipt()).toMatchObject({ state: 'completed' });
  expect(await runs()).toEqual([expect.objectContaining({ task_id: taskId, status: 'idle' })]);
  expect(upstream.create).not.toHaveBeenCalled();
});

test('an old failed create with no provider run ends as failed, not retried', async () => {
  upstream.create.mockRejectedValueOnce(new Error('create failed'));
  await expect(deliver()).rejects.toThrow();
  await db.execute(
    sql`update processed_webhook_event set processed_at = now() - interval '10 minutes'`,
  );
  expect(await deliver()).toEqual({ handled: false, reason: 'delivery_failed' });
  expect(await receipt()).toMatchObject({ state: 'failed', errorCode: 'SESSION_CREATION_FAILED' });
  expect(upstream.create).toHaveBeenCalledTimes(1);
});

test('an old receipt without a reserved session id fails without scanning the provider', async () => {
  await db.execute(sql`insert into processed_webhook_event (provider, event_id, event_type, payload)
    values ('composio', 'delivery_one', 'test', ${JSON.stringify({ state: 'ambiguous', taskId, errorCode: 'MIGRATED' })}::jsonb)`);
  expect(await deliver()).toEqual({ handled: false, reason: 'delivery_failed' });
  expect(await receipt()).toMatchObject({ errorCode: 'MISSING_SESSION_ID' });
  expect(upstream.list).not.toHaveBeenCalled();
});

test('an archived provider run fails the delivery and notifies the creator once', async () => {
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values (${randomUUID()}, ${ORG}, ${USER}, 'member', now())`);
  await db.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id) values (${ORG}, ${USER}, 'test-composio')`,
  );
  await db.execute(sql`update task set notification = 'app' where id = ${taskId}`);
  await db.execute(sql`insert into processed_webhook_event (provider, event_id, event_type, payload)
    values ('composio', 'delivery_one', 'test', ${JSON.stringify({ state: 'ambiguous', taskId, sessionId: randomUUID(), errorCode: 'MIGRATED' })}::jsonb)`);
  const stored = await receipt();
  if (typeof stored?.sessionId !== 'string') throw new Error('Missing reserved session ID');
  const processedAt = new Date(Date.now() - 10 * 60_000);
  await db.execute(sql`update processed_webhook_event set processed_at = ${processedAt}`);
  upstream.list.mockReturnValue([
    {
      id: 'discarded',
      metadata: { app_session_id: stored.sessionId },
      archived_at: new Date().toISOString(),
    },
  ]);
  expect(await deliver()).toEqual({ handled: false, reason: 'delivery_failed' });
  expect(await deliver()).toEqual({ handled: false, reason: 'delivery_failed' });
  expect(await runs()).toEqual([]);
  expect(upstream.list).toHaveBeenCalledWith(
    expect.objectContaining({
      'created_at[gte]': new Date(processedAt.getTime() - 60_000).toISOString(),
    }),
    { timeout: 30_000 },
  );
  const { rows } = await db.execute(
    sql`select kind, idempotency_key from notification where recipient_user_id = ${USER}`,
  );
  expect(rows).toEqual([
    { kind: 'task.failed', idempotency_key: 'trigger-delivery-failed:delivery_one' },
  ]);
});

test('a redelivery cannot complete a run while its opening message is still sending', async () => {
  let finishSend: () => void = () => {};
  let enteredSend: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    enteredSend = resolve;
  });
  const release = new Promise<void>((resolve) => {
    finishSend = resolve;
  });
  upstream.events.send.mockImplementationOnce(async () => {
    enteredSend();
    await release;
    return { data: [] };
  });
  const first = deliver();
  await entered;
  try {
    expect(await deliver()).toEqual({ handled: false, reason: 'delivery_in_progress' });
    expect(await receipt()).toMatchObject({ state: 'creating' });
    expect(await runs()).toEqual([expect.objectContaining({ status: 'opening' })]);
  } finally {
    finishSend();
    await first;
  }
  expect(await deliver()).toMatchObject({ handled: true });
  expect(upstream.create).toHaveBeenCalledOnce();
  expect(upstream.events.send).toHaveBeenCalledOnce();
});

test('an opening message that may have been sent is never sent again', async () => {
  upstream.events.send.mockRejectedValueOnce(new Error('opening send failed'));
  await expect(deliver()).rejects.toThrow();
  expect(await deliver()).toEqual({ handled: false, reason: 'delivery_ambiguous' });
  await db.execute(
    sql`update processed_webhook_event set processed_at = now() - interval '10 minutes'`,
  );
  expect(await deliver()).toEqual({ handled: false, reason: 'delivery_ambiguous' });
  expect(await receipt()).toMatchObject({ state: 'ambiguous' });
  expect(await runs()).toEqual([expect.objectContaining({ status: 'opening' })]);
  expect(upstream.create).toHaveBeenCalledOnce();
  expect(upstream.events.send).toHaveBeenCalledOnce();
  expect(upstream.list).not.toHaveBeenCalled();
});

test('an uncertain create is archived by the sweep and never revived by redelivery', async () => {
  upstream.create.mockRejectedValueOnce(new Error('lost create response'));
  await expect(deliver()).rejects.toThrow();
  const stored = await receipt();
  if (typeof stored?.sessionId !== 'string') throw new Error('Missing reserved session ID');
  upstream.list.mockReturnValue([
    {
      id: 'uncertain_remote',
      archived_at: null,
      metadata: { app_session_id: stored.sessionId },
    },
  ]);
  await db.execute(sql`update session set status_changed_at = now() - interval '10 minutes'`);
  await db.execute(
    sql`update processed_webhook_event set processed_at = now() - interval '10 minutes'`,
  );
  const { reconcileSessionCreation } = await import(
    '@/features/session-runtime/api/reconcile-session-creation'
  );
  await withRequestContext({ route: 'test/creation-cleanup' }, () =>
    reconcileSessionCreation('all-workspaces'),
  );
  expect(upstream.archive).toHaveBeenCalledWith('uncertain_remote', {}, { timeout: 30_000 });
  expect(await runs()).toEqual([expect.objectContaining({ status: 'terminated' })]);
  expect(await deliver()).toEqual({ handled: false, reason: 'delivery_failed' });
  expect(upstream.create).toHaveBeenCalledOnce();
  expect(upstream.events.send).not.toHaveBeenCalled();
});

// Notices go to workspace members, so the creator is one, with an optional credit limit.
async function seedOwner(creditLimit: number | null = null) {
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('delivery-owner', ${ORG}, ${USER}, 'owner', now())`,
  );
  await db.execute(sql`insert into workspace_member (organization_id, user_id, composio_user_id, credit_limit)
    values (${ORG}, ${USER}, 'delivery-member', ${creditLimit})`);
}

test('a delivery the spend gate refuses starts nothing and records why', async () => {
  await seedOwner();
  await seedCreditBalance(db, workspaceId, 0);
  await expect(deliver('delivery_broke')).resolves.toEqual({ handled: false, reason: 'credits' });
  expect(upstream.create).not.toHaveBeenCalled();
  expect(await runs()).toEqual([]);
  expect(await receipt('delivery_broke')).toEqual({ state: 'skipped', taskId, reason: 'credits' });
  // A redelivery reads the record instead of claiming again.
  await expect(deliver('delivery_broke')).resolves.toEqual({ handled: false, reason: 'credits' });
  const { rows } = await db.execute<{ kind: string; payload: { taskId: string } }>(
    sql`select kind, payload from notification where organization_id = ${ORG}`,
  );
  expect(rows).toEqual([
    expect.objectContaining({
      kind: 'credits.paused',
      payload: expect.objectContaining({ taskId }),
    }),
  ]);
});

test('a creator past their member limit gets no event run and the member-limit notice', async () => {
  await seedOwner(5);
  await db.execute(sql`insert into usage_event (workspace_id, user_id, event_type, credits_delta)
    values (${workspaceId}, ${USER}, 'model_request', -5)`);
  await expect(deliver('delivery_limit')).resolves.toEqual({
    handled: false,
    reason: 'member_limit',
  });
  expect(upstream.create).not.toHaveBeenCalled();
  expect(await receipt('delivery_limit')).toMatchObject({
    state: 'skipped',
    reason: 'member_limit',
  });
  const { rows } = await db.execute<{ payload: { pauseReason: string } }>(
    sql`select payload from notification where organization_id = ${ORG} and kind = 'credits.paused'`,
  );
  // The reason is stored so the feed row leaves out the Add credits button.
  expect(rows.map(({ payload }) => payload.pauseReason)).toEqual(['member_limit']);
});

test('a late failure cannot overwrite a completed delivery receipt', async () => {
  const completed = {
    state: 'completed',
    taskId,
    sessionId: randomUUID(),
    anthropicSessionId: 'remote',
    startedAt: new Date().toISOString(),
  };
  await db.execute(sql`insert into processed_webhook_event (provider, event_id, event_type, payload)
    values ('composio', 'delivery_done', 'test', ${JSON.stringify(completed)}::jsonb)`);
  for (const state of ['ambiguous', 'failed'] as const)
    expect(await recordTriggerDelivery('delivery_done', { state, taskId, errorCode: 'late' })).toBe(
      false,
    );
  expect(await receipt('delivery_done')).toMatchObject({ state: 'completed' });
});
