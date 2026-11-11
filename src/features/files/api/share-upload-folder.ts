import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { folder, folderShare } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { ROOT } from '../lib/paths';
import { loadShare, shareLinkState } from './live-share';

// Hold the target identity until insertion so a revoked or moved link cannot recreate its old path.
// The final read applies the same liveness rule as resolveUploadAccess, creator role included.
export async function lockShareUploadFolder(tx: DbTransaction, shareId: string, path: string) {
  const snapshot = (await tx.select().from(folderShare).where(eq(folderShare.id, shareId))).at(0);
  if (!snapshot) throw new AppError('FORBIDDEN', 'Share does not allow uploads.', {});
  let root = ROOT;
  if (snapshot.folderId !== null) {
    const target = (
      await tx
        .select()
        .from(folder)
        .where(and(eq(folder.id, snapshot.folderId), isNull(folder.deletedAt)))
        .for('update')
    ).at(0);
    if (!target) throw new AppError('FORBIDDEN', 'Shared folder is not available.', {});
    root = target.path;
  }
  const locked = (
    await tx.select().from(folderShare).where(eq(folderShare.id, shareId)).for('update')
  ).at(0);
  const share = locked && (await loadShare(locked.token, tx));
  if (
    !share ||
    share.mode !== 'edit' ||
    shareLinkState(share, new Date()) !== 'live' ||
    root !== path
  ) {
    throw new AppError('FORBIDDEN', 'Share does not allow uploads.', {});
  }
}
