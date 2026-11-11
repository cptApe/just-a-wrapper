import 'server-only';
import { type HandleUploadBody, handleUpload } from '@vercel/blob/client';
import { headers } from 'next/headers';
import { db } from '@/db';
import { getWorkspacePlanTier } from '@/features/billing/api/get-workspace-plan';
import { planLimits } from '@/features/billing/api/plan-limits';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { AppError } from '@/lib/errors';
import { refuseTeammateFoldersOnPath } from '../lib/team-folder';
import { requireOwnedUpload, uploadOwnerTag } from '../lib/upload-policy';
import type { UploadConfig } from '../types';
import { blobToken, storageEnabled } from './blob-storage';
import { authorizeProfileUpload, PROFILE_IMAGE_LIMIT } from './profile-images';
import { resolveUploadAccess } from './upload-access';

export async function uploadConfig(shareToken: string | null): Promise<UploadConfig> {
  if (!storageEnabled()) return { enabled: false, reason: CAPABILITY_OFF_MESSAGES.uploads };
  const actor = await resolveUploadAccess(shareToken, await headers());
  const plan = await getWorkspacePlanTier(actor.workspaceId);
  if (!plan)
    throw new AppError('WORKSPACE_NOT_FOUND', 'Workspace not found.', {
      workspaceId: actor.workspaceId,
    });
  return {
    enabled: true,
    uploadTag: uploadOwnerTag(actor.principal),
    maxFileBytes: (await planLimits(plan)).fileSizeBytes,
  };
}

export async function authorizeUpload(request: Request, body: HandleUploadBody) {
  return handleUpload({
    request,
    body,
    token: blobToken(),
    onBeforeGenerateToken: async (pathname) => {
      const profile = new URL(request.url).searchParams.get('profile');
      if (profile === 'avatar' || profile === 'workspace-icon') {
        await authorizeProfileUpload(request, profile, pathname);
        return {
          maximumSizeInBytes: PROFILE_IMAGE_LIMIT,
          allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          allowOverwrite: false,
          addRandomSuffix: false,
          validUntil: Date.now() + 300_000,
        };
      }
      const actor = await resolveUploadAccess(
        new URL(request.url).searchParams.get('share'),
        request.headers,
      );
      const { workspaceId } = actor;
      const split = requireOwnedUpload(workspaceId, actor.principal, pathname, actor.folderPath);
      // The metadata sync repeats this check; asking now keeps a refused file from uploading at all.
      if (actor.kind === 'member') await refuseTeammateFoldersOnPath(db, actor, split.folderPath);
      const plan = await getWorkspacePlanTier(workspaceId);
      if (!plan) throw new AppError('WORKSPACE_NOT_FOUND', 'Workspace not found.', { workspaceId });
      return {
        maximumSizeInBytes: (await planLimits(plan)).fileSizeBytes,
        allowOverwrite: false,
        addRandomSuffix: false,
        validUntil: Date.now() + 300_000,
      };
    },
    // Callbacks cannot reach localhost, so the browser persists metadata after upload succeeds.
  });
}
