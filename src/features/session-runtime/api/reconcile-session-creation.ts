import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import {
  failSessionCreation,
  recordSessionProbe,
  transitionSession,
} from '@/features/sessions/api/session-transitions';
import { SESSION_SEND_OPTIONS } from '@/features/sessions/constants';
import { recoverRows } from '@/lib/recover-rows';
import { sweepDeadline } from '@/lib/sweep-deadline';
import { readProviderSession } from './recover-session-claim';

/** One workspace for request paths; every workspace only for the recovery sweep. */
export type ReconcileScope = { workspaceId: string } | 'all-workspaces';

// Provider creation is non-idempotent. A timed-out request is discovered by its durable local ID,
// then archived; it is never repeated. No user message runs before ownership is attached.
export async function reconcileSessionCreation(scope: ReconcileScope): Promise<void> {
  const client = getAnthropicClient();
  if (!client) return;
  const rows = await db
    .select()
    .from(session)
    .where(
      and(
        inArray(session.status, ['creating', 'creation_cleanup']),
        sql`${session.statusChangedAt} < now() - interval '2 minutes'`,
        scope === 'all-workspaces' ? undefined : eq(session.workspaceId, scope.workspaceId),
      ),
    )
    .orderBy(sql`${session.lastStatusProbeAt} asc nulls first`, session.statusChangedAt)
    .limit(25);
  await recoverRows(rows, (row) => cleanUpCreation(client, row), { deadline: sweepDeadline() });
}

async function cleanUpCreation(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  row: typeof session.$inferSelect,
) {
  if (!(await recordSessionProbe(row.id, row.stateVersion))) return;
  if (
    row.status === 'creating' &&
    !(await failSessionCreation(db, row.id, row.anthropicSessionId, row.stateVersion))
  )
    return;
  if (row.anthropicSessionId) {
    const id = row.anthropicSessionId;
    const upstream = await readProviderSession(id, () =>
      client.beta.sessions.retrieve(id, {}, { timeout: 30_000 }),
    );
    if (upstream && (await interruptOrArchive(client, upstream))) return;
  } else {
    for await (const candidate of client.beta.sessions.list(
      {
        'created_at[gte]': new Date(row.createdAt.getTime() - 60_000).toISOString(),
        include_archived: true,
      },
      { timeout: 30_000 },
    )) {
      if (candidate.metadata.app_session_id !== row.id) continue;
      if (await interruptOrArchive(client, candidate)) return;
      break;
    }
  }
  await transitionSession({
    executor: db,
    where: eq(session.id, row.id),
    to: 'terminated',
    expected: null,
    pause: null,
    activity: null,
  });
}

async function interruptOrArchive(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  upstream: { id: string; status: string; archived_at: string | null },
): Promise<boolean> {
  if (upstream.archived_at) return false;
  if (upstream.status === 'running' || upstream.status === 'rescheduling') {
    await client.beta.sessions.events.send(
      upstream.id,
      { events: [{ type: 'user.interrupt' }] },
      SESSION_SEND_OPTIONS,
    );
    return true;
  }
  await client.beta.sessions.archive(upstream.id, {}, { timeout: 30_000 });
  return false;
}
