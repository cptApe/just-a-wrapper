import 'server-only';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { file, folder, folderShare } from '@/db/schema';
import { AppError } from '@/lib/errors';

// Revoked links never become live again, including after restoring their target.
export async function revokeShares(
  connection: DbTransaction | typeof db,
  predicate: SQL | undefined,
) {
  const now = new Date();
  return connection
    .update(folderShare)
    .set({ revokedAt: now })
    .where(and(predicate, isNull(folderShare.revokedAt)))
    .returning({ id: folderShare.id });
}

export async function createShareRow(values: typeof folderShare.$inferInsert) {
  return db.transaction(async (tx) => {
    if (values.folderId) {
      const target = (
        await tx
          .select({ id: folder.id })
          .from(folder)
          .where(and(eq(folder.id, values.folderId), isNull(folder.deletedAt)))
          .for('update')
      ).at(0);
      if (!target) throw new AppError('TOOL_INPUT_INVALID', 'folder not found', {});
    }
    if (values.fileId) {
      const target = (
        await tx
          .select({ id: file.id })
          .from(file)
          .where(and(eq(file.id, values.fileId), isNull(file.deletedAt)))
          .for('update')
      ).at(0);
      if (!target) throw new AppError('TOOL_INPUT_INVALID', 'file not found', {});
    }
    const row = (await tx.insert(folderShare).values(values).returning()).at(0);
    if (!row) throw new AppError('UNEXPECTED', 'Share insert returned no row.', {});
    return row;
  });
}
