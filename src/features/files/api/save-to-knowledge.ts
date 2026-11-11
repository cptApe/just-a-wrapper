import { importDriveFile } from '@/features/files/api/import-drive-file';
import { discardImportedFile } from '@/features/files/api/trash-transitions';
import { ARTIFACTS_FOLDER_PATH } from '@/features/files/lib/paths';
import { captureEvent } from '@/lib/analytics';
import { shipLog } from '@/lib/logger';
import { storageCapability } from '@/lib/runtime-capabilities';
import 'server-only';
import { loadOwnedArtifact } from './artifact-access';
import { openArtifactContent } from './artifact-content';
import { claimArtifactSave } from './artifact-transitions';

export type SaveToKnowledgeResult = { savedDriveFileId: string; alreadySaved: boolean };

// Each person keeps their own Library copy; saving again returns that copy.
export async function saveArtifactToKnowledge(input: {
  artifactId: string;
  workspaceId: string;
  userId: string;
}): Promise<SaveToKnowledgeResult> {
  const owned = await loadOwnedArtifact({
    artifactId: input.artifactId,
    workspaceId: input.workspaceId,
    viewerId: input.userId,
  });
  if (owned.savedDriveFileId) {
    return { savedDriveFileId: owned.savedDriveFileId, alreadySaved: true };
  }
  // Refuse before downloading anything when there is nowhere to store the copy.
  storageCapability();

  // openArtifactContent enforces downloadability and types the failure modes.
  const content = await openArtifactContent({ artifact: owned, disposition: 'attachment' });
  const bytes = new Uint8Array(await content.arrayBuffer());

  const driveFile = await importDriveFile({
    workspaceId: input.workspaceId,
    userId: input.userId,
    bytes,
    filename: owned.filename,
    mimeType: owned.mimeType,
    folderPath: ARTIFACTS_FOLDER_PATH,
    source: 'session_output',
    sessionId: owned.sessionId,
  });

  const saved = await claimArtifactSave({
    artifactId: owned.id,
    userId: input.userId,
    fileId: driveFile.id,
  });
  if (saved && saved.fileId !== driveFile.id) {
    // A concurrent save by the same person won; keep theirs and drop this copy.
    await discardImportedFile(driveFile.id);
    return { savedDriveFileId: saved.fileId, alreadySaved: true };
  }

  shipLog({
    msg: 'artifact.saved_to_knowledge',
    feature: 'artifacts',
    op: 'save-to-knowledge',
    artifact_id: owned.id,
    drive_file_id: driveFile.id,
    size_bytes: bytes.byteLength,
  });
  captureEvent(
    'artifact:save',
    { artifact_id: owned.id, mime_type: owned.mimeType, size_bytes: bytes.byteLength },
    { userId: input.userId, workspaceId: input.workspaceId },
  );
  return { savedDriveFileId: driveFile.id, alreadySaved: false };
}
