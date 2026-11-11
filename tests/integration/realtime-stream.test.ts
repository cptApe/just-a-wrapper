/** Live updates to open browsers: who receives which event, replay after reconnect, and cleanup; real Postgres and the real SSE response. */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool, schema } from './helpers/test-db';

const pool = makeTestPool();
const database = makeTestDb(pool);
const { publishSessionEvent, publishWorkspaceEvent } = await import(
  '@/features/realtime/api/publish'
);
const { realtimeStream } = await import('@/features/realtime/api/stream');
const { purgeExpiredRealtimeRows } = await import('@/features/realtime/api/purge');
const { eventAudienceQuery } = await import('@/features/realtime/lib/audience');
const identity = { organizationId: 'org', userId: 'alice' };
beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  await truncateAll(database);
  await seedOrganization(database, 'org');
  await seedOrganization(database, 'other');
  for (const userId of ['alice', 'bob']) {
    await seedUser(database, userId);
    await database.insert(schema.member).values({
      id: userId,
      userId,
      organizationId: 'org',
      role: 'member',
      createdAt: new Date(Date.now() - 60_000),
    });
    await database
      .insert(schema.workspaceMember)
      .values({ userId, organizationId: 'org', composioUserId: userId });
  }
});
afterAll(() => pool.end());
test("a private chat's events reach only its creator, and a workspace's events never leave it", async () => {
  await publishSessionEvent(
    { type: 'session_title', sessionId: randomUUID(), title: 'Private' },
    { organizationId: 'org', session: { visibility: 'private', createdByUserId: 'alice' } },
  );
  await publishWorkspaceEvent('other', { type: 'credits', balance: 99 });
  const alice = await database
    .select()
    .from(schema.realtimeEvent)
    .where(eventAudienceQuery('org', 'alice', 0n));
  const bob = await database
    .select()
    .from(schema.realtimeEvent)
    .where(eventAudienceQuery('org', 'bob', 0n));
  expect(alice.map((row) => row.type)).toEqual(['session_title']);
  expect(bob).toEqual([]);
});
test('an open stream delivers a new event and closes once the member is removed', async () => {
  const abort = new AbortController();
  const response = await realtimeStream(
    new Request('http://localhost/api/realtime/stream', {
      signal: abort.signal,
    }),
    identity,
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing SSE response');
  await reader.read();
  await publishWorkspaceEvent('org', {
    type: 'session_title',
    sessionId: randomUUID(),
    title: 'Client plan',
  });
  let frames = '';
  while (!frames.includes('Client plan')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Stream ended before event');
    frames += new TextDecoder().decode(chunk.value);
  }
  expect(frames).toContain('id:');
  await database.delete(schema.member).where(eq(schema.member.id, 'alice'));
  while (!(await reader.read()).done) {
    /* Drain until the membership gate closes the stream. */
  }
  abort.abort();
});
test('the purge dry run counts expired events without deleting them, and the real run deletes them', async () => {
  await database.insert(schema.realtimeEvent).values({
    organizationId: 'org',
    type: 'credits',
    payload: { type: 'credits', balance: 0, publishedAt: 0 },
    createdAt: new Date(0),
  });
  expect((await purgeExpiredRealtimeRows({ dryRun: true })).events).toBe(1);
  expect((await purgeExpiredRealtimeRows({ dryRun: false })).events).toBe(1);
  expect(await database.select().from(schema.realtimeEvent)).toHaveLength(0);
});

test('a reconnect with an expired cursor restarts at the latest event instead of replaying old history', async () => {
  const [expired] = await database
    .insert(schema.realtimeEvent)
    .values({
      organizationId: 'org',
      type: 'credits',
      payload: { type: 'credits', balance: 1, publishedAt: 0 },
      createdAt: new Date(Date.now() - 360_000),
    })
    .returning();
  if (!expired) throw new Error('Missing expired fixture');
  await publishWorkspaceEvent('org', { type: 'credits', balance: 2 });
  const latest = await database.query.realtimeEvent.findFirst({
    where: eq(schema.realtimeEvent.organizationId, 'org'),
    orderBy: (event, { desc }) => [desc(event.id)],
  });
  if (!latest) throw new Error('Missing latest fixture');
  const abort = new AbortController();
  const response = await realtimeStream(
    new Request('http://localhost/api/realtime/stream', {
      signal: abort.signal,
      headers: { 'Last-Event-ID': expired.id.toString() },
    }),
    identity,
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing SSE response');
  try {
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain(`event: cursor\nid: ${latest.id}\n`);
    expect(latest.id).not.toBe(expired.id);
    await publishWorkspaceEvent('org', {
      type: 'session_title',
      sessionId: randomUUID(),
      title: 'After reset',
    });
    let frames = '';
    while (!frames.includes('After reset')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Stream ended before new event');
      frames += new TextDecoder().decode(chunk.value);
    }
    expect(frames).not.toContain('"type":"credits"');
  } finally {
    abort.abort();
    while (!(await reader.read()).done) {
      /* Drain until the aborted stream closes. */
    }
  }
});

test('a reconnect never replays events from before the member joined', async () => {
  const joinedAt = new Date(Date.now() - 10_000);
  await database
    .update(schema.member)
    .set({ createdAt: joinedAt })
    .where(eq(schema.member.id, 'alice'));
  const [cursor] = await database
    .insert(schema.realtimeEvent)
    .values({
      organizationId: 'org',
      type: 'credits',
      payload: { type: 'credits', balance: 0, publishedAt: 0 },
      createdAt: new Date(joinedAt.getTime() - 20_000),
    })
    .returning();
  if (!cursor) throw new Error('Missing cursor fixture');
  await database.insert(schema.realtimeEvent).values({
    organizationId: 'org',
    type: 'session_title',
    payload: {
      type: 'session_title',
      sessionId: randomUUID(),
      title: 'Before membership',
      publishedAt: 0,
    },
    createdAt: new Date(joinedAt.getTime() - 1),
  });
  await publishWorkspaceEvent('org', {
    type: 'session_title',
    sessionId: randomUUID(),
    title: 'After membership',
  });
  const abort = new AbortController();
  const response = await realtimeStream(
    new Request('http://localhost/api/realtime/stream', {
      signal: abort.signal,
      headers: { 'Last-Event-ID': cursor.id.toString() },
    }),
    identity,
  );
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing SSE response');
  try {
    let frames = '';
    while (!frames.includes('After membership')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Stream ended before replay');
      frames += new TextDecoder().decode(chunk.value);
    }
    expect(frames).not.toContain('Before membership');
  } finally {
    abort.abort();
    while (!(await reader.read()).done) {
      /* Drain until the aborted stream closes. */
    }
  }
});

test.each([
  '10000000000000000000',
  '-1',
])('a reconnect with the out-of-range cursor %s is refused', async (cursor) => {
  await expect(
    realtimeStream(
      new Request('http://localhost/api/realtime/stream', {
        headers: { 'Last-Event-ID': cursor },
      }),
      identity,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_BODY' });
});
