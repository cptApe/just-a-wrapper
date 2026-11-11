import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { file, session } from '@/db/schema';
import { fileContentUrl } from '@/lib/file-content-url';
import { fileVisibleTo } from '../lib/team-folder';

/** Library files belonging to an already-authorized session, including uploads. */
export async function listSessionFiles(input: {
  anthropicSessionId: string;
  workspaceId: string;
  viewerId: string;
}) {
  const rows = await db
    .select({
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
    })
    .from(file)
    .innerJoin(session, eq(file.sessionId, session.id))
    .where(
      and(
        eq(session.anthropicSessionId, input.anthropicSessionId),
        eq(session.workspaceId, input.workspaceId),
        eq(file.workspaceId, input.workspaceId),
        isNull(file.deletedAt),
        fileVisibleTo(input.viewerId),
      ),
    )
    .orderBy(asc(file.createdAt));
  return rows.map((row) => ({
    ...row,
    url: fileContentUrl(row.id, null),
    createdAt: row.createdAt.toISOString(),
  }));
}
