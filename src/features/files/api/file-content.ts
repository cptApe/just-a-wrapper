import 'server-only';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { db } from '@/db';
import { file } from '@/db/schema';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { MAX_SESSION_MOUNT_BYTES } from '../lib/limits';
import { fileVisibleTo } from '../lib/team-folder';
import { downloadBlob, readBlobBytes, signedBlobUrl } from './blob-storage';
import { loadLiveShare, shareFileScope } from './live-share';

async function accessPredicate(request: Request, fileId: string): Promise<SQL> {
  const shareToken = new URL(request.url).searchParams.get('share');
  if (shareToken) {
    const share = await loadLiveShare(shareToken);
    if (!share) throw new AppError('ARTIFACT_NOT_FOUND', 'File is not available.', { fileId });
    return shareFileScope(share);
  }
  const actor = await resolveCaller(request.headers);
  return sql`${eq(file.workspaceId, actor.workspaceId)} and ${fileVisibleTo(actor.userId)}`;
}

export async function readFileContent(
  request: Request,
  fileId: string,
  variant: 'content' | 'thumbnail',
): Promise<Response> {
  const url = new URL(request.url);
  const predicate = await accessPredicate(request, fileId);
  const row = (
    await db
      .select()
      .from(file)
      .where(and(eq(file.id, fileId), isNull(file.deletedAt), predicate))
      .limit(1)
  ).at(0);
  if (!row) throw new AppError('ARTIFACT_NOT_FOUND', 'File is not available.', { fileId });
  const pathname =
    variant === 'content' || row.thumbnailPath === null ? row.storagePath : row.thumbnailPath;
  if (variant === 'content' && url.searchParams.get('download') === '1')
    return downloadBlob(pathname, row.filename);
  if (variant === 'content' && url.searchParams.get('text') === '1') {
    const bytes = await readBlobBytes(pathname, MAX_SESSION_MOUNT_BYTES);
    return new Response(bytes, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  const location = await signedBlobUrl(pathname);
  return new Response(null, {
    status: 307,
    headers: { location, 'cache-control': 'private, max-age=240' },
  });
}
