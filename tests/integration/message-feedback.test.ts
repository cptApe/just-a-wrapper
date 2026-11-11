/** Thumbs and notes on agent messages: saved even when the agent never hears them, read back per chat; real Postgres, Anthropic faked. */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { messageFeedback } from '@/db/schema';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { seedChatSession } from './helpers/seed-chat-session';
import { writeGrantForTest } from './helpers/session-grant';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const anthropic = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/features/agents/api/anthropic-client', async (original) => {
  const client = () => ({ beta: { sessions: { events: { send: anthropic.send } } } });
  return {
    ...(await original<typeof import('@/features/agents/api/anthropic-client')>()),
    getAnthropicClient: client,
    requireAnthropicClient: client,
  };
});
vi.mock('@/lib/observability', () => ({ captureException: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => ({ userId: 'owner', organizationId: 'org' })),
);

const { submitMessageFeedback: submit } = await import('@/features/feedback/api/submit-feedback');
const { getMessageFeedback } = await import('@/features/chat/api/message-feedback');
const { withRequestContext } = await import('@/lib/request-context');
const submitMessageFeedback = (input: Parameters<typeof submit>[0]) =>
  withRequestContext({ route: 'test/feedback' }, () => submit(input));

const pool = makeTestPool();
const db = makeTestDb(pool);
beforeAll(() => applyMigrations(db));
afterAll(() => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  anthropic.send.mockReset();
  await seedUser(db, 'owner');
  await seedOrganization(db, 'org');
  await db.execute(sql`insert into workspace (organization_id, name) values ('org', 'Org')`);
  await db.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('org-owner', 'org', 'owner', 'owner', now())`);
});

const chat = () =>
  seedChatSession(db, 'org', {
    createdByUserId: 'owner',
    anthropicSessionId: 'sesn_feedback',
    workspaceMemoryAccess: 'read_write',
  });

async function grant() {
  const row = await chat();
  return writeGrantForTest({
    workspaceId: row.workspaceId,
    organizationId: 'org',
    userId: 'owner',
    sessionRowId: row.id,
    anthropicSessionId: 'sesn_feedback',
  });
}

test('a note the agent received reports delivered', async () => {
  anthropic.send.mockResolvedValue({});
  const result = await submitMessageFeedback({
    grant: await grant(),
    eventId: 'evt_1',
    rating: 'up',
    comment: 'Clear answer',
    final: true,
  });
  expect(result).toEqual({ delivered: true });
  expect(anthropic.send).toHaveBeenCalledOnce();
});

test('a note the agent never received is still saved and reports not delivered', async () => {
  anthropic.send.mockRejectedValue(new Error('session is archived'));
  const result = await submitMessageFeedback({
    grant: await grant(),
    eventId: 'evt_1',
    rating: 'down',
    comment: 'Wrong file',
    final: true,
  });
  expect(result).toEqual({ delivered: false });
  expect(await db.select().from(messageFeedback)).toMatchObject([
    { rating: 'down', comment: 'Wrong file' },
  ]);
});

test('reopening a chat shows the rating on every message, not only the first', async () => {
  const row = await chat();
  await db.execute(sql`insert into message_feedback (workspace_id, session_id, user_id, anthropic_event_id, rating)
    select workspace_id, id, 'owner', 'first', 'up' from session where id = ${row.id}
    union all select workspace_id, id, 'owner', 'second', 'down' from session where id = ${row.id}`);
  const feedback = await getMessageFeedback(row.id);
  if (!feedback.ok) throw new Error('Expected the feedback read to succeed');
  expect(feedback.data).toEqual({
    first: { rating: 'up', comment: '' },
    second: { rating: 'down', comment: '' },
  });
});
