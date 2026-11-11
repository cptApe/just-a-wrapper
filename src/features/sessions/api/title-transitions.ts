import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { UNTITLED_SESSION_TITLE } from '../lib/untitled-session-title';

export async function storeGeneratedTitleTransition(
  providerId: string,
  workspaceId: string,
  title: string,
) {
  const rows = await db
    .update(session)
    .set({ title })
    .where(
      and(
        eq(session.anthropicSessionId, providerId),
        eq(session.workspaceId, workspaceId),
        eq(session.title, UNTITLED_SESSION_TITLE),
        isNull(session.hiddenAt),
      ),
    )
    .returning({
      id: session.id,
      visibility: session.visibility,
      createdByUserId: session.createdByUserId,
    });
  return rows.at(0) ?? null;
}
