import 'server-only';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { loadLiveShare } from './live-share';

export async function resolveUploadAccess(token: string | null, headers: Headers) {
  if (token) {
    const share = await loadLiveShare(token);
    if (!share || share.fileId || share.mode !== 'edit') {
      throw new AppError('FORBIDDEN', 'Share does not allow uploads.', {});
    }
    return {
      kind: 'share' as const,
      share,
      userId: share.createdByUserId,
      workspaceId: share.workspaceId,
      principal: `share:${share.id}`,
      folderPath: share.folderPath,
    };
  }
  const actor = await resolveCaller(headers);
  return { kind: 'member' as const, ...actor, principal: actor.userId, folderPath: '/' };
}

export type UploadAccess = Awaited<ReturnType<typeof resolveUploadAccess>>;
