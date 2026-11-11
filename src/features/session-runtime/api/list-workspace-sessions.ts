import { publicSessionStatus } from '@/features/sessions/lib/session-machine';
import 'server-only';
import { and, desc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { sessionReadState, session as sessionTable, user } from '@/db/schema';
import { runAfterResponse } from '@/features/sessions/api/create-background-work';
import { safeParseSessionId, sessionVisibleToViewer } from '@/features/sessions/api/session-access';
import type {
  WorkspaceSessionDetail,
  WorkspaceSessionListItem,
  WorkspaceSessionsPage,
} from '@/features/sessions/types';
import { AppError } from '@/lib/errors';
import {
  type DispatchPendingToolCalls,
  reconcileWorkspaceSessions,
} from './reconcile-stale-sessions';

// Pinned order belongs in pagination, not a client re-sort, so unloaded pinned tasks cannot
// disappear. Encode the total order as an opaque cursor.
const sessionsCursorSchema = z.object({
  fa: z.string().nullable(),
  le: z.string().nullable(),
  ca: z.string(),
  id: z.string(),
});
type SessionsCursor = z.infer<typeof sessionsCursorSchema>;

function encodeCursor(item: WorkspaceSessionListItem): string {
  const cursor: SessionsCursor = {
    fa: item.favoritedAt ? item.favoritedAt.toISOString() : null,
    le: item.lastEventAt ? item.lastEventAt.toISOString() : null,
    ca: item.createdAt.toISOString(),
    id: item.id,
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(raw: string): SessionsCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch (cause) {
    throw new AppError(
      'TOOL_INPUT_INVALID',
      'malformed sessions cursor',
      { cursor: raw },
      { cause },
    );
  }
  const cursor = sessionsCursorSchema.safeParse(parsed);
  if (cursor.success) return cursor.data;
  throw new AppError('TOOL_INPUT_INVALID', 'malformed sessions cursor', { cursor: raw });
}

// Truncate created_at to milliseconds in both ordering and cursor comparison.
// JavaScript Date cannot preserve Postgres microseconds; id breaks resulting ties.
// last_event_at writers use Date already and need no truncation.
const createdAtMs = sql`date_trunc('milliseconds', ${sessionTable.createdAt})`;

// Nullable cursor keys sort last. A pinned cursor includes the unpinned tail; an unpinned cursor
// must never bring pinned rows back.
function cursorCondition(cursor: SessionsCursor): SQL {
  const tieBreak = sql`(${createdAtMs}, ${sessionTable.id}) < (${cursor.ca}::timestamptz, ${cursor.id}::uuid)`;
  // The last_event_at keyset, evaluated only within an equal favorited_at group.
  const withinFavorited =
    cursor.le === null
      ? sql`(${sessionTable.lastEventAt} is null and ${tieBreak})`
      : sql`(
          ${sessionTable.lastEventAt} < ${cursor.le}::timestamptz
          or (${sessionTable.lastEventAt} = ${cursor.le}::timestamptz and ${tieBreak})
          or ${sessionTable.lastEventAt} is null
        )`;
  // favorited_at is the primary key. A null cursor is an unfavorited row, so the
  // whole remaining stream is also unfavorited (null); a non-null cursor admits
  // any lower pin, the full unfavorited tail, then ties on the same pin instant.
  if (cursor.fa === null) {
    return sql`(${sessionTable.favoritedAt} is null and ${withinFavorited})`;
  }
  return sql`(
    ${sessionTable.favoritedAt} < ${cursor.fa}::timestamptz
    or ${sessionTable.favoritedAt} is null
    or (${sessionTable.favoritedAt} = ${cursor.fa}::timestamptz and ${withinFavorited})
  )`;
}

const DEFAULT_PAGE_SIZE = 20;

async function queryPage(input: {
  workspaceId: string;
  viewerId: string;
  limit: number;
  cursor?: string | null;
}): Promise<WorkspaceSessionListItem[]> {
  // Unread = events the viewer hasn't seen. LEFT JOIN keeps never-opened
  // sessions in the list (no read-state row yet = unread if anything happened).
  const unread = sql<boolean>`(
        ${sessionTable.lastEventAt} is not null
        and (${sessionReadState.lastReadAt} is null or ${sessionTable.lastEventAt} > ${sessionReadState.lastReadAt})
      )`;
  const base = sessionListProjection(unread);
  const joined = base.leftJoin(
    sessionReadState,
    and(
      eq(sessionReadState.sessionId, sessionTable.id),
      eq(sessionReadState.userId, input.viewerId),
    ),
  );
  const rows = await joined
    .where(
      and(
        eq(sessionTable.workspaceId, input.workspaceId),
        eq(sessionTable.kind, 'chat'),
        isNotNull(sessionTable.anthropicSessionId),
        isNull(sessionTable.hiddenAt),
        sessionVisibleToViewer(input.viewerId),
        input.cursor ? cursorCondition(decodeCursor(input.cursor)) : undefined,
      ),
    )
    .orderBy(
      // Pinned first, newest pin first; then normal recency within each group.
      sql`${sessionTable.favoritedAt} desc nulls last`,
      sql`${sessionTable.lastEventAt} desc nulls last`,
      sql`${createdAtMs} desc`,
      desc(sessionTable.id),
    )
    .limit(input.limit);
  return rows.map(({ createdByName, createdByEmail, createdByImage, unread: u, ...rest }) => ({
    ...rest,
    status: publicSessionStatus(rest.status),
    createdBy: { name: createdByName, email: createdByEmail, image: createdByImage },
    unread: Boolean(u),
  }));
}

/** Fetch limit+1 rows to decide whether infinite scroll has another page
 * without issuing a separate count query. */
export async function listWorkspaceSessionsPage(input: {
  workspaceId: string;
  viewerId: string;
  limit?: number;
  cursor?: string | null;
  dispatchPendingToolCalls: DispatchPendingToolCalls;
}): Promise<WorkspaceSessionsPage> {
  const { dispatchPendingToolCalls, ...query } = input;
  // Provider repair publishes fresh status after the read; a failed probe cannot fail the list.
  runAfterResponse('session-list-reconcile', { workspaceId: input.workspaceId }, () =>
    reconcileWorkspaceSessions({
      workspaceId: input.workspaceId,
      rateLimit: true,
      dispatchPendingToolCalls,
    }),
  );
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  const rows = await queryPage({ ...query, limit: limit + 1 });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

// Task headers can render before upstream creation, so this read does not require an upstream ID.
// Visibility still applies and upstream IDs never reach clients.
export async function getWorkspaceSession(input: {
  sessionId: string;
  workspaceId: string;
  /** The viewer, for the visibility gate — a private session of another member returns null. */
  viewerId: string;
}): Promise<WorkspaceSessionDetail | null> {
  const sessionId = safeParseSessionId(input.sessionId);
  if (!sessionId) return null;
  const row = (
    await db
      .select({
        id: sessionTable.id,
        title: sessionTable.title,
        tier: sessionTable.tier,
        status: sessionTable.status,
        favoritedAt: sessionTable.favoritedAt,
        lastEventAt: sessionTable.lastEventAt,
        createdAt: sessionTable.createdAt,
        visibility: sessionTable.visibility,
        createdByUserId: sessionTable.createdByUserId,
        createdByName: user.name,
        createdByEmail: user.email,
        createdByImage: user.image,
      })
      .from(sessionTable)
      .innerJoin(user, eq(user.id, sessionTable.createdByUserId))
      .where(
        and(
          eq(sessionTable.workspaceId, input.workspaceId),
          eq(sessionTable.id, sessionId),
          isNull(sessionTable.hiddenAt),
          // another member's private task is not visible here either (the page
          // then renders its own not-found via the stream gate).
          sessionVisibleToViewer(input.viewerId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!row) return null;
  const { createdByName, createdByEmail, createdByImage, ...rest } = row;
  return {
    ...rest,
    status: publicSessionStatus(rest.status),
    createdBy: { name: createdByName, email: createdByEmail, image: createdByImage },
    unread: false,
    isOwner: rest.createdByUserId === input.viewerId,
  };
}

function sessionListProjection(unread: SQL<boolean>) {
  return (
    db
      .select({
        id: sessionTable.id,
        title: sessionTable.title,
        status: sessionTable.status,
        favoritedAt: sessionTable.favoritedAt,
        lastEventAt: sessionTable.lastEventAt,
        createdAt: sessionTable.createdAt,
        visibility: sessionTable.visibility,
        createdByUserId: sessionTable.createdByUserId,
        createdByName: user.name,
        createdByEmail: user.email,
        createdByImage: user.image,
        unread,
      })
      .from(sessionTable)
      // created_by_user_id is NOT NULL with an onDelete:'restrict' FK, so every
      // session has a live creator row — an inner join can't drop a listed session.
      .innerJoin(user, eq(user.id, sessionTable.createdByUserId))
  );
}
