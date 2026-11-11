import { and, eq, sql } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';
import { db } from '@/db';
import {
  pendingConfirmation,
  sessionShare,
  session as sessionTable,
  workspace,
  workspaceNotDeleted,
} from '@/db/schema';
import { listSessionEvents } from '@/features/sessions';
import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import 'server-only';
import { publicShareStatus } from '../lib/public-share-status';
import { projectPublicTranscript } from '../lib/public-transcript';
import type { PublicTranscriptItem } from '../types';

// Public resolution for /share/[token] when the token points at a chat thread —
// NO auth. Returns a discriminated result so the page renders exactly one state,
// mirroring the folder resolver (features/files/api/resolve-share.ts). Liveness
// (revoked / expired / soft-deleted / workspace not live) is computed at request
// time; the transcript is listed with OUR server-side Anthropic credentials
// (listSessionEvents → getAnthropicClient), never the owner's browser session, so
// a logged-out visitor can read a public thread.

const DEFAULT_TITLE = 'Untitled task';

// The server-side transcript walk is cached per session for this long. Liveness
// (the session_share + session row) is read
// FRESH on every request outside the cache, so revoke / delete stay instant — only
// the expensive transcript walk is amortized.
const TRANSCRIPT_TTL_SECONDS = 60;

type ResolvedSessionShare =
  | { status: 'not_found' }
  | { status: 'revoked' }
  | { status: 'expired' }
  | { status: 'unavailable' }
  | {
      status: 'live';
      workspaceName: string;
      title: string;
      items: PublicTranscriptItem[];
    };

// Cached transcript fetch — keyed by the Anthropic session id (arg → cache key).
// Wrapped in its own request context because unstable_cache runs the callback in
// a detached scope where the outer request's ALS is gone, and listSessionEvents
// calls extend() (which throws without a context). A thrown Anthropic error is NOT
// cached (unstable_cache only stores resolved values), so a transient outage
// retries on the next hit instead of being pinned for the TTL.
const loadTranscriptCached = unstable_cache(
  (anthropicSessionId: string) =>
    withRequestContext({ route: 'share-page-transcript', feature: 'chat' }, () =>
      listSessionEvents(anthropicSessionId),
    ),
  ['session-share-transcript'],
  { revalidate: TRANSCRIPT_TTL_SECONDS },
);

export const resolveSessionShare = cache(async (token: string): Promise<ResolvedSessionShare> => {
  const row = (
    await db
      .select({
        sessionId: sessionShare.sessionId,
        expiresAt: sessionShare.expiresAt,
        revokedAt: sessionShare.revokedAt,
        hiddenAt: sessionTable.hiddenAt,
        anthropicSessionId: sessionTable.anthropicSessionId,
        title: sessionTable.title,
        workspaceName: workspace.name,
        workspaceLive: sql<boolean>`${workspaceNotDeleted}`,
      })
      .from(sessionShare)
      .innerJoin(sessionTable, eq(sessionTable.id, sessionShare.sessionId))
      .innerJoin(workspace, eq(workspace.id, sessionShare.workspaceId))
      .where(eq(sessionShare.token, token))
      .limit(1)
  ).at(0);

  if (!row) return { status: 'not_found' };

  const status = publicShareStatus(
    {
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      hiddenAt: row.hiddenAt,
      workspaceLive: row.workspaceLive,
    },
    new Date(),
  );
  if (status !== 'live') return { status };

  // A not-yet-relayed session has no Anthropic id (and so no transcript yet); the
  // link still resolves to an empty, live thread.
  let items: PublicTranscriptItem[] = [];
  if (row.anthropicSessionId) {
    try {
      const events = await loadTranscriptCached(row.anthropicSessionId);
      // Read the approval queue fresh so a cached transcript cannot hide a pending decision.
      const pending = await db
        .select({ toolUseId: pendingConfirmation.toolUseId })
        .from(pendingConfirmation)
        .where(
          and(
            eq(pendingConfirmation.sessionId, row.sessionId),
            eq(pendingConfirmation.status, 'pending'),
          ),
        );
      items = projectPublicTranscript(events, new Set(pending.map((call) => call.toolUseId)));
    } catch (error) {
      // Transcript or approval loading failed; show a plain notice instead of a 500.
      // Failed reads are not cached, so the next request retries.
      captureException(error, { op: 'share-transcript-load', route: 'share-page' });
      return { status: 'unavailable' };
    }
  }

  return {
    status: 'live',
    workspaceName: row.workspaceName,
    title: row.title?.trim() || DEFAULT_TITLE,
    items,
  };
});
