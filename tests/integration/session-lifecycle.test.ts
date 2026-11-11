/** A chat's status, pause, opening, hide, archive and delete moves, on real Postgres: stale work never undoes newer state. */
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { realtimeEvent, session, sessionReadState } from '@/db/schema';
import { seedCreditBalance } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const boundary = vi.hoisted(() => ({ after: [] as Array<() => Promise<void>> }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (callback: () => Promise<void>) => boundary.after.push(callback),
}));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => ({
    userId: 'owner',
    name: 'Owner',
    organizationId: 'org',
  })),
);
vi.mock('@/lib/observability', () => ({
  captureException: vi.fn(),
  flushObservability: async () => {},
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

const { claimSessionResume } = await import('@/features/billing/api/claim-session-resume');
const transitions = await import('@/features/sessions/api/session-transitions');
const { claimSessionOpening } = await import('@/features/sessions/api/claim-session-opening');
const { hideSession } = await import('@/features/sessions/api/update-session');
const { storeGeneratedTitleTransition } = await import('@/features/sessions/api/title-transitions');
const { markSessionSeen } = await import('@/features/sessions/api/mark-session-seen');
const { listScheduledItems } = await import('@/features/tasks/api/list-scheduled-items');
const { transitionSession, finishSessionResume } = transitions;

const pool = makeTestPool();
const db = makeTestDb(pool);
let workspaceId: string;
beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  boundary.after.length = 0;
  await seedUser(db, 'owner');
  await seedOrganization(db, 'org');
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('org-owner', 'org', 'owner', 'owner', now())`);
  await db.execute(sql`insert into auth_session (id, expires_at, token, updated_at, user_id, active_organization_id)
    values ('owner-session', now() + interval '1 day', 'owner-token', now(), 'owner', 'org')`);
  const ws = (
    await db.execute<{ id: string }>(
      sql`insert into workspace (organization_id, name) values ('org', 'Test') returning id`,
    )
  ).rows.at(0);
  assert.ok(ws);
  workspaceId = ws.id;
  // A resume passes the creator's spend gate.
  await seedCreditBalance(db, workspaceId, 100);
});

type Status = typeof session.$inferSelect.status;
const PAUSED: Status[] = ['paused_no_credits', 'pausing', 'resuming'];

async function seed(
  status: Status,
  visibility: 'private' | 'workspace' = 'private',
  anthropicSessionId = 'sesn_test',
) {
  const row = (
    await db
      .insert(session)
      .values({
        workspaceMemoryAccess: 'read_write',
        workspaceId,
        createdByUserId: 'owner',
        tier: 'default',
        kind: 'chat',
        anthropicSessionId,
        status,
        visibility,
        pausedAt: PAUSED.includes(status) ? new Date() : null,
        pausedReason: PAUSED.includes(status) ? 'credits' : null,
      })
      .returning()
  ).at(0);
  assert.ok(row);
  return row;
}

function move(
  id: string,
  to: Status,
  extra: Partial<
    Pick<Parameters<typeof transitionSession>[0], 'expected' | 'activity' | 'pause'>
  > = {},
) {
  return transitionSession({
    executor: db,
    where: eq(session.id, id),
    to,
    expected: null,
    activity: null,
    pause: null,
    ...extra,
  });
}

const current = async (id?: string) =>
  (
    await db
      .select()
      .from(session)
      .where(id ? eq(session.id, id) : undefined)
  ).at(0);

test('a failed resume that finishes late cannot bring a terminated chat back', async () => {
  const row = await seed('paused_no_credits');
  const claim = await claimSessionResume({
    workspaceId: row.workspaceId,
    anthropicSessionId: 'sesn_test',
  });
  assert.ok(claim);
  await move(row.id, 'terminated');
  expect(await finishSessionResume(claim, 'paused_no_credits')).toBe(false);
  expect((await current())?.status).toBe('terminated');
});

test('a replayed running event cannot lift a credit pause', async () => {
  const row = await seed('paused_no_credits');
  expect(await move(row.id, 'running')).toHaveLength(0);
});

test('a terminated chat refuses every later status move', async () => {
  const row = await seed('terminated');
  expect(
    await move(row.id, 'paused_no_credits', { pause: { reason: 'credits', at: new Date() } }),
  ).toHaveLength(0);
  expect(await transitions.attachCreatedSession(row.id, 'provider', { deferred: true })).toBeNull();
  expect(await transitions.failSessionCreation(db, row.id, 'provider', row.stateVersion)).toBe(
    false,
  );
});

test('two resumes of one paused chat start it once, and the winner cannot be rolled back', async () => {
  const row = await seed('paused_no_credits');
  const claims = await Promise.all([
    claimSessionResume({ workspaceId: row.workspaceId, anthropicSessionId: 'sesn_test' }),
    claimSessionResume({ workspaceId: row.workspaceId, anthropicSessionId: 'sesn_test' }),
  ]);
  const winners = claims.filter((claim) => claim !== null);
  expect(winners).toHaveLength(1);
  assert.ok(winners[0]);
  expect(await finishSessionResume(winners[0], 'running')).toBe(true);
  expect(await finishSessionResume(winners[0], 'paused_no_credits')).toBe(false);
  expect(await current()).toMatchObject({ pausedReason: null, pausedAt: null });
});

test('a member-limit pause resumes once the limit is gone', async () => {
  const row = await seed('paused_no_credits');
  await db.execute(sql`update session set paused_reason = 'member_limit' where id = ${row.id}`);
  const claim = await claimSessionResume({
    workspaceId: row.workspaceId,
    anthropicSessionId: 'sesn_test',
  });
  expect(claim?.status).toBe('resuming');
});

test('a writer holding an old version cannot move a chat that came back to the same status', async () => {
  const row = await seed('running');
  await move(row.id, 'idle');
  await move(row.id, 'running');
  expect(
    await move(row.id, 'idle', { expected: { status: 'running', version: row.stateVersion } }),
  ).toHaveLength(0);
});

test('a repeated status event moves recency once, not on every replay', async () => {
  const row = await seed('idle');
  const activity = { at: new Date(), stopReason: 'end_turn' as const };
  expect(await move(row.id, 'idle', { activity })).toHaveLength(1);
  expect(await move(row.id, 'idle', { activity })).toHaveLength(0);
});

test('two simultaneous opening claims send one opening, and a stale release cannot undo it', async () => {
  const row = await seed('awaiting_opening');
  const owner = { sessionId: row.id, workspaceId: row.workspaceId, createdByUserId: 'owner' };
  const results = await Promise.allSettled([
    claimSessionOpening(owner),
    claimSessionOpening(owner),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'INVALID_BODY' },
  });
  expect((await current())?.status).toBe('opening');
  await move(row.id, 'running');
  expect(await transitions.releaseSessionOpening(row.id, row.stateVersion)).toBe(false);
});

test('a generated title never replaces a title the user chose', async () => {
  const row = await seed('idle');
  await db.update(session).set({ title: 'Chosen title' }).where(eq(session.id, row.id));
  expect(
    await storeGeneratedTitleTransition('sesn_test', row.workspaceId, 'Stale title'),
  ).toBeNull();
  expect((await current())?.title).toBe('Chosen title');
});

test('marking a chat seen never moves the read cursor backwards', async () => {
  const row = await seed('idle');
  const future = new Date(Date.now() + 60_000);
  await db.insert(sessionReadState).values({
    sessionId: row.id,
    workspaceId: row.workspaceId,
    userId: 'owner',
    lastReadAt: future,
  });
  await markSessionSeen({
    sessionId: row.id,
    workspaceId: row.workspaceId,
    userId: 'owner',
    organizationId: 'org',
  });
  expect((await db.select().from(sessionReadState)).at(0)?.lastReadAt).toEqual(future);
});

test('two status probes cannot run at once, and a terminated chat is never probed', async () => {
  const row = await seed('running');
  expect(await transitions.recordSessionProbe(row.id, row.stateVersion)).toBe(true);
  expect(await transitions.recordSessionProbe(row.id, row.stateVersion)).toBe(false);
  await move(row.id, 'terminated');
  const terminal = await current();
  assert.ok(terminal);
  expect(await transitions.recordSessionProbe(row.id, terminal.stateVersion)).toBe(false);
});

test('pause recovery waits out a live pause and hands an expired one to exactly one worker', async () => {
  const row = await seed('pausing');
  expect(await transitions.renewSessionPause(row.id, 'credits')).toBeNull();
  await db.execute(
    sql`update session set status_changed_at = now() - interval '3 minutes' where id = ${row.id}`,
  );
  const claims = await Promise.all([
    transitions.renewSessionPause(row.id, 'credits'),
    transitions.renewSessionPause(row.id, 'credits'),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  await move(row.id, 'terminated');
  expect(await transitions.renewSessionPause(row.id, 'credits')).toBeNull();
});

test('a scheduled run stopped by its budget shows as stopped, not completed', async () => {
  const row = await seed('running');
  await db.update(session).set({ kind: 'task_run' }).where(eq(session.id, row.id));
  await move(row.id, 'idle', { activity: { at: new Date(), stopReason: 'budget_reached' } });
  expect((await current())?.endedAt).toBeNull();
  const groups = await listScheduledItems({ workspaceId: row.workspaceId, viewerUserId: 'owner' });
  expect(groups.history.find((item) => item.id === row.id)?.status).toBe('stopped');
});

test('an expired task pause finishes once and never after a newer version or a resume', async () => {
  const row = await seed('paused_no_credits');
  await db
    .update(session)
    .set({ kind: 'task_run', pausedAt: new Date(0) })
    .where(eq(session.id, row.id));
  const input = { sessionId: row.id, version: row.stateVersion, cutoff: new Date() };
  expect(
    await transitions.finishExpiredTaskPause(db, { ...input, version: row.stateVersion + 1 }),
  ).toBe(false);
  expect(await transitions.finishExpiredTaskPause(db, input)).toBe(true);
  expect(await transitions.finishExpiredTaskPause(db, input)).toBe(false);
  const claim = await claimSessionResume({
    workspaceId: row.workspaceId,
    anthropicSessionId: 'sesn_test',
  });
  assert.ok(claim);
  expect(
    await transitions.finishExpiredTaskPause(db, { ...input, version: claim.stateVersion }),
  ).toBe(false);
});

test('ending a chat records the provider time, and hiding a live chat ends it in the same write', async () => {
  const row = await seed('running');
  const at = new Date('2026-01-01T00:00:00Z');
  await move(row.id, 'terminated', { activity: { at, stopReason: null } });
  expect((await current())?.endedAt).toEqual(at);
  const live = await seed('running', 'private', 'sesn_live');
  await hideSession({ sessionId: live.id, workspaceId: live.workspaceId });
  expect(await current(live.id)).toMatchObject({
    status: 'terminated',
    hiddenAt: expect.any(Date),
  });
});

test('hiding an ended chat keeps its end time and a second hide changes nothing', async () => {
  const row = await seed('terminated');
  const endedAt = new Date('2026-01-01T00:00:00Z');
  await db.update(session).set({ endedAt }).where(eq(session.id, row.id));
  await hideSession({ sessionId: row.id, workspaceId: row.workspaceId });
  const hidden = await current();
  expect(hidden?.endedAt).toEqual(endedAt);
  assert.ok(hidden?.hiddenAt);
  expect(await transitions.hideSessionTransition(db, eq(session.id, row.id))).toEqual([]);
  expect((await current())?.hiddenAt).toEqual(hidden.hiddenAt);
});

test('the database refuses a hidden live chat and a provider archive of a visible chat', async () => {
  const row = await seed('running');
  await expect(
    db.update(session).set({ hiddenAt: new Date() }).where(eq(session.id, row.id)),
  ).rejects.toThrow();
  await expect(
    db
      .update(session)
      .set({ status: 'terminated', providerArchivedAt: new Date() })
      .where(eq(session.id, row.id)),
  ).rejects.toThrow();
});

test('an archive acknowledgement for a visible chat or an old version is ignored', async () => {
  const row = await seed('terminated');
  expect(await transitions.markSessionArchived(row.id, row.stateVersion)).toBe(false);
  await db.update(session).set({ hiddenAt: new Date() }).where(eq(session.id, row.id));
  await transitions.markSessionArchived(row.id, row.stateVersion + 1);
  expect((await current())?.providerArchivedAt).toBeNull();
  await transitions.markSessionArchived(row.id, row.stateVersion);
  expect((await current())?.providerArchivedAt).not.toBeNull();
});

test.each([
  'workspace',
  'private',
] as const)('deleting a %s chat tells other viewers through one event that carries no chat content', async (visibility) => {
  const { DELETE } = await import('@/app/api/sessions/[id]/route');
  const row = await seed('idle', visibility);
  const response = await DELETE(
    new Request(`http://localhost/api/sessions/${row.id}`, { method: 'DELETE' }) as never,
    { params: Promise.resolve({ id: row.id }) },
  );
  expect(response.status).toBe(200);
  for (const callback of boundary.after.splice(0)) await callback();
  const events = await db.select().from(realtimeEvent);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ organizationId: 'org', type: 'session_visibility' });
  if (visibility === 'workspace') expect(events[0]?.audienceUserId).toBeNull();
  expect(events[0]?.payload).toEqual({
    type: 'session_visibility',
    sessionId: row.id,
    visibility,
    publishedAt: expect.anything(),
  });
});
