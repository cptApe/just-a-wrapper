import 'server-only';
import { and, eq, gt, inArray, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { artifactSave, file, folder, folderShare, sessionFileMount } from '@/db/schema';
import { unlinkSavedFiles } from '@/features/files/api/artifact-transitions';
import { captureException } from '@/lib/observability';
import { DeadlineReached } from '@/lib/sweep-deadline';
import { trashCutoff, trashMachine } from '../lib/trash-machine';
import { cleanupBlob, deleteBlob, storageEnabled } from './blob-storage';
import { deleteSessionFileMounts } from './session-file-mounts';
import { revokeShares } from './share-transitions';

type Connection = DbTransaction | typeof db;

function trashGuard(
  column: typeof file.deletedAt | typeof folder.deletedAt,
  destination: 'live' | 'trashed' | 'purged' | 'discarded',
  now: Date,
) {
  const predicates = trashMachine.sourcesOf(destination).map((state) => {
    switch (state) {
      case 'live':
        return isNull(column);
      case 'trashed':
        return gt(column, trashCutoff(now));
      case 'expired':
        return lte(column, trashCutoff(now));
      case 'discarded':
      case 'purged':
        return sql`false`;
    }
  });
  return or(...predicates);
}

export async function transitionFiles(
  connection: Connection,
  predicate: SQL | undefined,
  deletedAt: Date | null,
): Promise<(typeof file.$inferSelect)[]> {
  if (connection === db) return db.transaction((tx) => transitionFiles(tx, predicate, deletedAt));
  const guard = trashGuard(file.deletedAt, deletedAt === null ? 'live' : 'trashed', new Date());
  const moved = await connection
    .update(file)
    .set({ deletedAt })
    .where(and(predicate, guard))
    .returning();
  if (deletedAt !== null && moved.length > 0) {
    await unlinkSavedFiles(
      connection,
      moved.map((row) => row.id),
    );
    await revokeShares(
      connection,
      inArray(
        folderShare.fileId,
        moved.map((row) => row.id),
      ),
    );
  }
  return moved;
}

export async function transitionFolders(
  connection: Connection,
  predicate: SQL | undefined,
  deletedAt: Date | null,
): Promise<(typeof folder.$inferSelect)[]> {
  if (connection === db) return db.transaction((tx) => transitionFolders(tx, predicate, deletedAt));
  const guard = trashGuard(folder.deletedAt, deletedAt === null ? 'live' : 'trashed', new Date());
  const moved = await connection
    .update(folder)
    .set({ deletedAt })
    .where(and(predicate, guard))
    .returning();
  if (deletedAt !== null) {
    for (const row of moved) {
      await revokeShares(
        connection,
        and(
          eq(folderShare.workspaceId, row.workspaceId),
          eq(folderShare.folderId, row.id),
          isNull(folderShare.fileId),
        ),
      );
    }
  }
  return moved;
}

/**
 * Remove expired trash: first each file's own bytes, by its exact storage paths,
 * then the rows whose bytes are gone. A file whose bytes could not be removed
 * keeps its row and is retried on the next run, so the stored-file sweep never
 * has to guess which unreferenced bytes a purge left behind.
 */
export async function purgeTrashRows(now: Date, dryRun: boolean) {
  const expiredGuard = trashGuard(file.deletedAt, 'purged', now);
  const folderGuard = trashGuard(folder.deletedAt, 'purged', now);
  const candidates = await db.select().from(file).where(expiredGuard);
  const failed: Array<{ pathname: string; error: string }> = [];
  if (dryRun) return { removed: candidates, failed };
  const deadline = Date.now() + 60_000;
  const unmounted: typeof candidates = [];
  for (const candidate of candidates) {
    try {
      await deleteSessionFileMounts(eq(sessionFileMount.fileId, candidate.id), deadline);
      unmounted.push(candidate);
    } catch (cause) {
      if (cause instanceof DeadlineReached) break;
      captureException(cause, { feature: 'files', op: 'retention-retry' });
      // Keep this file and its blobs for retry while unrelated tenants continue retention.
      failed.push({
        pathname: candidate.storagePath,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  const bytesGone = await deleteStoredBytes(unmounted, failed);
  const removed = await db.transaction(async (tx) => {
    const rows =
      bytesGone.length === 0
        ? []
        : await tx
            .delete(file)
            .where(
              and(
                expiredGuard,
                inArray(file.id, bytesGone),
                sql`not exists (select 1 from ${sessionFileMount} where ${sessionFileMount.fileId} = ${file.id})`,
              ),
            )
            .returning();
    await tx.delete(folder).where(folderGuard);
    return rows;
  });
  return { removed, failed };
}

// Without storage there are no bytes to remove, so every row may go.
async function deleteStoredBytes(
  rows: Array<typeof file.$inferSelect>,
  failed: Array<{ pathname: string; error: string }>,
): Promise<string[]> {
  if (!storageEnabled()) return rows.map((row) => row.id);
  const gone: string[] = [];
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500);
    const paths = batch.flatMap((row) =>
      row.thumbnailPath === null ? [row.storagePath] : [row.storagePath, row.thumbnailPath],
    );
    try {
      await deleteBlob(paths);
      gone.push(...batch.map((row) => row.id));
    } catch (cause) {
      captureException(cause, { feature: 'files', op: 'retention-blob-delete' });
      for (const row of batch)
        failed.push({
          pathname: row.storagePath,
          error: cause instanceof Error ? cause.message : String(cause),
        });
    }
  }
  return gone;
}

// A losing import is never published. Remove it only while no save points at it.
export async function discardImportedFile(fileId: string) {
  const rows = await db
    .delete(file)
    .where(
      and(
        eq(file.id, fileId),
        eq(file.source, 'session_output'),
        trashGuard(file.deletedAt, 'discarded', new Date()),
        sql`not exists (select 1 from ${artifactSave} where ${artifactSave.fileId} = ${file.id})`,
      ),
    )
    .returning();
  for (const row of rows) {
    await cleanupBlob(row.storagePath);
    if (row.thumbnailPath !== null) await cleanupBlob(row.thumbnailPath);
  }
}
