import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { file } from '@/db/schema';

// Reusing a Library file in another session preserves its original session.
export async function linkFileOrigin(
  fileId: string,
  sessionId: string,
): Promise<'linked' | 'unchanged'> {
  const moved = await db
    .update(file)
    .set({ sessionId })
    .where(and(eq(file.id, fileId), isNull(file.sessionId), isNull(file.deletedAt)))
    .returning({ id: file.id });
  return moved.length > 0 ? 'linked' : 'unchanged';
}
