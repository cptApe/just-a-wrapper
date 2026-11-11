import { AppError } from '@/lib/errors';
import { isWithin, splitStoragePath } from './paths';

export function requireUploadPath(workspaceId: string, pathname: string, folderPath: string) {
  const split = splitStoragePath(workspaceId, pathname);
  if (!split || !isWithin(folderPath, split.folderPath) || pathname.includes('/.thumbs/')) {
    throw new AppError('FORBIDDEN', 'Upload path is outside the allowed folder.', { workspaceId });
  }
  return split;
}

// Bind uploads to a member or edit share: workspace scoping alone lets one member claim another's bytes.
// The token route and metadata route both enforce the same uploader prefix.
export function uploadOwnerTag(principal: string): string {
  return principal.startsWith('share:') ? `s-${principal.slice(6)}` : `u-${principal}`;
}

export function requireOwnedUpload(
  workspaceId: string,
  principal: string,
  pathname: string,
  folderPath: string,
) {
  const split = requireUploadPath(workspaceId, pathname, folderPath);
  if (principal.startsWith('share:') && split.folderPath !== folderPath) {
    throw new AppError('FORBIDDEN', 'Share uploads must stay in the shared folder.', {
      workspaceId,
    });
  }
  if (!split.filename.startsWith(`${uploadOwnerTag(principal)}-`)) {
    throw new AppError('FORBIDDEN', 'This upload belongs to another uploader.', { workspaceId });
  }
  return split;
}
