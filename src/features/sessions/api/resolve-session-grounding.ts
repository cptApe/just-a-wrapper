import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable, user, workspace } from '@/db/schema';
import { tierSupportsSystemMessages } from '@/features/agents';
import { parseReplyLanguage, type ReplyLanguage } from '@/features/preferences/lib/reply-language';
import { resolveEffectiveTimeZone } from '@/features/preferences/lib/time-preferences';
import { logger } from '@/lib/logger';

// Missing identity rows yield unnamed UTC context so opening messages remain valid; lookup
// failures propagate.
// Timezone resolution prefers the saved member choice, then browser detection, then UTC; invalid
// stored zones are reported and skipped.
export async function resolveSessionStartGrounding(input: {
  userId: string;
  workspaceId: string;
}): Promise<{
  displayName: string | null;
  workspaceName: string | null;
  timeZone: string;
  replyLanguage: ReplyLanguage | null;
}> {
  const [userRows, workspaceRows] = await Promise.all([
    db
      .select({
        name: user.name,
        timezone: user.timezone,
        browserTimezone: user.browserTimezone,
        replyLanguage: user.replyLanguage,
      })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1),
    db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, input.workspaceId))
      .limit(1),
  ]);
  const userRow = userRows.at(0);
  return {
    displayName: userRow?.name ?? null,
    workspaceName: workspaceRows.at(0)?.name ?? null,
    timeZone: resolveEffectiveTimeZone(userRow ?? {}, logger()),
    replyLanguage: parseReplyLanguage(userRow?.replyLanguage),
  };
}

// Use the creator timezone and stored tier for follow-up grounding. A missing session uses UTC and
// inline context, avoiding an unsupported system message.
export async function resolveSessionSendGrounding(
  anthropicSessionId: string,
): Promise<{ timeZone: string; supportsSystemMessages: boolean }> {
  const row = (
    await db
      .select({
        timezone: user.timezone,
        browserTimezone: user.browserTimezone,
        tier: sessionTable.tier,
      })
      .from(sessionTable)
      .innerJoin(user, eq(sessionTable.createdByUserId, user.id))
      .where(eq(sessionTable.anthropicSessionId, anthropicSessionId))
      .limit(1)
  ).at(0);
  return {
    timeZone: resolveEffectiveTimeZone(row ?? {}, logger()),
    supportsSystemMessages: row ? tierSupportsSystemMessages(row.tier) : false,
  };
}
