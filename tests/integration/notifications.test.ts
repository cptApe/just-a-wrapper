// Who gets a notification, the feed, and email delivery and retries, on real Postgres; only Resend is faked.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool, schema } from './helpers/test-db';

const delivery = vi.hoisted(() => ({ failed: false, recipients: [] as string[] }));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async ({ to }: { to: string }) => {
        delivery.recipients.push(to);
        if (to === 'alice@example.test' && !delivery.failed) {
          delivery.failed = true;
          return { data: null, error: { message: 'temporary rejection' } };
        }
        return { data: { id: to }, error: null };
      },
    };
  },
}));
vi.stubEnv('RESEND_API_KEY', 're_test');
const pool = makeTestPool();
const database = makeTestDb(pool);
const { readNotificationFeed, markNotificationsRead } = await import(
  '@/features/notifications/api/feed'
);
const { notify } = await import('@/features/notifications/api/notify');
const { notifyTaskEvent } = await import('@/features/notifications/api/notify-task-events');
const { withRequestContext } = await import('@/lib/request-context');
const identity = { organizationId: 'org', userId: 'alice' };
beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  delivery.failed = false;
  delivery.recipients.length = 0;
  await truncateAll(database);
  for (const organizationId of ['org', 'other']) await seedOrganization(database, organizationId);
  for (const userId of ['alice', 'bob']) {
    await seedUser(database, userId);
    await database
      .insert(schema.member)
      .values({ id: userId, organizationId: 'org', userId, role: 'member', createdAt: new Date() });
    await database
      .insert(schema.workspaceMember)
      .values({ organizationId: 'org', userId, composioUserId: userId });
  }
  await database.insert(schema.notification).values(
    Array.from({ length: 25 }, (_, index) => ({
      organizationId: 'org',
      recipientUserId: 'alice',
      kind: 'credits.paused',
      payload: { title: `Notice ${index}` },
    })),
  );
  await database.insert(schema.notification).values([
    { organizationId: 'other', recipientUserId: 'alice', kind: 'credits.paused', payload: {} },
    { organizationId: 'org', recipientUserId: 'bob', kind: 'credits.paused', payload: {} },
  ]);
});
afterAll(() => pool.end());
test('the feed shows only my notices in this workspace, pages through all of them and marks them read', async () => {
  const first = await readNotificationFeed(identity, { filter: 'unread', after: null });
  expect(first.items).toHaveLength(20);
  expect(first.metadata.unreadCount).toBe(25);
  const second = await readNotificationFeed(identity, { filter: 'unread', after: first.after });
  expect(second.items).toHaveLength(5);
  expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(25);
  await markNotificationsRead(identity, { scope: 'all' });
  expect(
    (await readNotificationFeed(identity, { filter: 'unread', after: null })).metadata.unreadCount,
  ).toBe(0);
});
test('opening the feed clears the badge without marking notices read or counting as activity', async () => {
  await readNotificationFeed(identity, { filter: 'all', after: null });
  const member = await database.query.workspaceMember.findFirst();
  expect(member?.lastActiveAt).toBeNull();
  await markNotificationsRead(identity, { scope: 'seen' });
  const page = await readNotificationFeed(identity, { filter: 'all', after: null });
  expect(page.metadata.unseenCount).toBe(0);
  expect(page.metadata.unreadCount).toBe(25);
});

test('one rejected email does not block the others and a retry sends only the unsent one', async () => {
  const payload = { organizationId: 'org', idempotencyKey: 'retry-me', data: {} };
  await expect(
    withRequestContext({ route: 'test.notify' }, () => notify('credits.paused', payload)),
  ).resolves.toBeUndefined();
  expect([...delivery.recipients].sort()).toEqual(['alice@example.test', 'bob@example.test']);
  await withRequestContext({ route: 'test.notify' }, () => notify('credits.paused', payload));
  expect(
    delivery.recipients.filter((recipient) => recipient === 'alice@example.test'),
  ).toHaveLength(2);
  expect(delivery.recipients.filter((recipient) => recipient === 'bob@example.test')).toHaveLength(
    1,
  );
  const sent = await database.query.notification.findMany();
  expect(
    sent.filter((row) => row.idempotencyKey === 'retry-me' && row.emailStatus === 'sent'),
  ).toHaveLength(2);
});

test('marking read again keeps the first read time', async () => {
  const row = await database.query.notification.findFirst({
    where: eq(schema.notification.recipientUserId, identity.userId),
  });
  if (!row) throw new Error('Missing notification fixture');
  const originalReadAt = new Date('2026-01-01T00:00:00.000Z');
  await database
    .update(schema.notification)
    .set({ readAt: originalReadAt })
    .where(eq(schema.notification.id, row.id));
  await markNotificationsRead(identity, { scope: 'all' });
  const updated = await database.query.notification.findFirst({
    where: eq(schema.notification.id, row.id),
  });
  expect(updated?.readAt).toEqual(originalReadAt);
});

test('two senders cannot both claim one email and a stale finish cannot undo sent', async () => {
  const { claimNotificationEmail, finishNotificationEmail } = await import(
    '@/features/notifications/api/notification-transitions'
  );
  const rows = await database
    .insert(schema.notification)
    .values({
      organizationId: 'org',
      recipientUserId: 'alice',
      kind: 'credits.paused',
      payload: {},
      emailStatus: 'pending',
    })
    .returning();
  const row = rows.at(0);
  expect(row).toBeDefined();
  if (!row) throw new Error('Missing test notification');
  const claims = await Promise.all([
    claimNotificationEmail(row.id),
    claimNotificationEmail(row.id),
  ]);
  const winners = claims.filter((claim) => claim !== null);
  expect(winners).toHaveLength(1);
  const claim = winners.at(0);
  if (!claim) throw new Error('Missing email claim');
  expect(await finishNotificationEmail(row.id, claim, 'sent')).toBe(true);
  expect(await finishNotificationEmail(row.id, claim, 'pending')).toBe(false);
  expect(await claimNotificationEmail(row.id)).toBeNull();
});

test('marking read when nothing is unread changes nothing', async () => {
  const { transitionNotificationsRead } = await import(
    '@/features/notifications/api/notification-transitions'
  );
  expect(await transitionNotificationsRead('org', 'alice', null)).toBe(true);
  expect(await transitionNotificationsRead('org', 'alice', null)).toBe(false);
});

test('replaying a notification nobody could receive neither republishes it nor emails later', async () => {
  await database.update(schema.workspaceMember).set({ lastActiveAt: new Date() });
  const payload = { organizationId: 'org', idempotencyKey: 'eligibility-is-fixed', data: {} };
  await notify('credits.paused', payload);
  const firstEvents = await database.select().from(schema.realtimeEvent);
  await database.update(schema.workspaceMember).set({ lastActiveAt: new Date(0) });
  await notify('credits.paused', payload);
  expect(delivery.recipients).toEqual([]);
  expect(await database.select().from(schema.realtimeEvent)).toHaveLength(firstEvents.length);
});

test('two deliveries of one notification at once send each person one email', async () => {
  delivery.failed = true;
  const payload = { organizationId: 'org', idempotencyKey: 'concurrent-delivery', data: {} };
  await Promise.all([notify('credits.paused', payload), notify('credits.paused', payload)]);
  expect([...delivery.recipients].sort()).toEqual(['alice@example.test', 'bob@example.test']);
});

test('the email sweep finishes stuck emails once without sending them twice', async () => {
  const { retryNotificationEmails } = await import(
    '@/features/notifications/api/retry-notification-emails'
  );
  await notify('credits.paused', { organizationId: 'org', data: {} });
  await database.execute(
    sql`update notification set email_status='sending', email_claimed_at=now()-interval '6 minutes' where email_status='sent'`,
  );
  await retryNotificationEmails();
  const rows = await database.select().from(schema.notification);
  expect(rows.filter((row) => row.emailStatus === 'sent')).toHaveLength(2);
  expect(delivery.recipients).toHaveLength(4);
  await retryNotificationEmails();
  expect(delivery.recipients).toHaveLength(4);
});
test('the email sweep sends a bounded batch and two sweeps at once send each email once', async () => {
  const { retryNotificationEmails } = await import(
    '@/features/notifications/api/retry-notification-emails'
  );
  delivery.failed = true;
  await database.insert(schema.notification).values(
    Array.from({ length: 30 }, () => ({
      organizationId: 'org',
      recipientUserId: 'alice',
      kind: 'credits.paused',
      payload: { link: '/app' },
      emailStatus: 'pending' as const,
    })),
  );
  await retryNotificationEmails();
  expect(delivery.recipients).toHaveLength(25);
  await Promise.all([retryNotificationEmails(), retryNotificationEmails()]);
  expect(delivery.recipients).toHaveLength(30);
});

test('old failed emails expire and cannot block a new one', async () => {
  await database
    .update(schema.notification)
    .set({ emailStatus: 'pending', createdAt: new Date(Date.now() - 2 * 86_400_000) });
  await database.insert(schema.notification).values({
    organizationId: 'org',
    recipientUserId: 'bob',
    kind: 'credits.paused',
    payload: { link: '/app' },
    emailStatus: 'pending',
  });
  const { retryNotificationEmails } = await import(
    '@/features/notifications/api/retry-notification-emails'
  );
  await withRequestContext({ route: 'test' }, retryNotificationEmails);
  expect(delivery.recipients).toEqual(['bob@example.test']);
  const old = await database
    .select({ emailStatus: schema.notification.emailStatus })
    .from(schema.notification)
    .where(eq(schema.notification.recipientUserId, 'alice'));
  expect(new Set(old.map((row) => row.emailStatus))).toEqual(new Set(['expired']));
});

test('an abandoned email claim expires while a live one is left to finish', async () => {
  const { retryNotificationEmails } = await import(
    '@/features/notifications/api/retry-notification-emails'
  );
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
  const claimed = {
    organizationId: 'org',
    recipientUserId: 'bob',
    kind: 'credits.paused',
    payload: { link: '/app' },
    emailStatus: 'sending' as const,
    createdAt: twoDaysAgo,
  };
  const [abandoned, live] = await database
    .insert(schema.notification)
    .values([
      { ...claimed, emailClaimedAt: new Date(Date.now() - 600_000) },
      { ...claimed, emailClaimedAt: new Date() },
    ])
    .returning();
  await retryNotificationEmails();
  const status = async (id: string | undefined) =>
    (
      await database
        .select({ emailStatus: schema.notification.emailStatus })
        .from(schema.notification)
        .where(eq(schema.notification.id, id ?? ''))
    ).at(0)?.emailStatus;
  expect(await status(abandoned?.id)).toBe('expired');
  expect(await status(live?.id)).toBe('sending');
  expect(delivery.recipients).toEqual([]);
});

test('a retry sends nothing to a person who turned email off or left the workspace', async () => {
  const { retryNotificationEmails } = await import(
    '@/features/notifications/api/retry-notification-emails'
  );
  await database
    .insert(schema.notificationPreference)
    .values({ userId: 'alice', category: 'account_billing', inApp: true, email: false });
  await database.delete(schema.member).where(eq(schema.member.userId, 'bob'));
  const pending = {
    organizationId: 'org',
    kind: 'credits.paused',
    payload: { link: '/retry' },
    emailStatus: 'pending' as const,
  };
  await database.insert(schema.notification).values([
    { ...pending, recipientUserId: 'alice' },
    { ...pending, recipientUserId: 'bob' },
  ]);
  await retryNotificationEmails();
  expect(delivery.recipients).toEqual([]);
  const rows = await database
    .select({ emailStatus: schema.notification.emailStatus })
    .from(schema.notification)
    .where(sql`${schema.notification.payload} ->> 'link' = '/retry'`);
  expect(rows.map((row) => row.emailStatus)).toEqual(['skipped', 'skipped']);
});

test('a retry still sends a schedule email the person asked for', async () => {
  const { retryNotificationEmails } = await import(
    '@/features/notifications/api/retry-notification-emails'
  );
  delivery.failed = true;
  await database.insert(schema.notification).values({
    organizationId: 'org',
    recipientUserId: 'alice',
    kind: 'task.failed',
    payload: { link: '/app/scheduled', emailReason: 'schedule', body: 'Paused.' },
    emailStatus: 'pending',
  });
  await retryNotificationEmails();
  expect(delivery.recipients).toEqual(['alice@example.test']);
});

test('a schedule set to email reaches a person who is active right now', async () => {
  delivery.failed = true;
  await database.update(schema.workspaceMember).set({ lastActiveAt: new Date() });
  await notify('task.failed', {
    organizationId: 'org',
    recipientUserIds: ['alice'],
    channels: { inApp: true, email: 'force' },
    data: { title: 'Scheduled task paused', body: 'The schedule was paused.' },
  });
  expect(delivery.recipients).toEqual(['alice@example.test']);
});

test('task emails go only where the schedule or the chat creator asked, and nowhere when preferences cannot be read', async () => {
  delivery.failed = true;
  const [workspace] = await database
    .insert(schema.workspace)
    .values({ organizationId: 'org', name: 'Org' })
    .returning();
  if (!workspace) throw new Error('Missing workspace fixture');
  let runs = 0;
  async function finish(kind: 'chat' | 'task_run', notification?: 'email' | 'app' | 'off') {
    runs++;
    let taskId: string | null = null;
    if (notification) {
      const { rows } = await database.execute<{ id: string }>(
        sql`insert into task (workspace_id, created_by_user_id, title, trigger_type, cron_schedule, notification)
          values (${workspace?.id}, 'alice', 'Report', 'schedule', '0 9 * * *', ${notification}) returning id`,
      );
      taskId = rows.at(0)?.id ?? null;
    }
    await database.execute(sql`insert into session
        (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, anthropic_session_id, task_id)
      values ('none', ${workspace?.id}, 'default', 'alice', ${kind}, ${`sesn_${runs}`}, ${taskId})`);
    delivery.recipients.length = 0;
    await notifyTaskEvent({
      anthropicSessionId: `sesn_${runs}`,
      event: 'task.completed',
      eventId: `run_${runs}`,
    });
    return [...delivery.recipients];
  }
  // Both people turned task email on; a schedule still decides for its own runs.
  await database.insert(schema.notificationPreference).values(
    ['alice', 'bob'].map((userId) => ({
      userId,
      category: 'task_alerts' as const,
      inApp: true,
      email: true,
    })),
  );
  expect(await finish('task_run', 'email')).toEqual(['alice@example.test']);
  expect(await finish('task_run', 'app')).toEqual([]);
  expect(await finish('task_run', 'off')).toEqual([]);
  expect(await finish('task_run')).toEqual([]);
  // A private chat emails only its creator, and only after they opted in.
  expect(await finish('chat')).toEqual(['alice@example.test']);
  await database.update(schema.notificationPreference).set({ email: false });
  expect(await finish('chat')).toEqual([]);
  await database.update(schema.notificationPreference).set({ email: true });
  await database.execute(
    sql`alter table notification_preference rename to notification_preference_unavailable`,
  );
  try {
    expect(await finish('chat')).toEqual([]);
  } finally {
    await database.execute(
      sql`alter table notification_preference_unavailable rename to notification_preference`,
    );
  }
});
