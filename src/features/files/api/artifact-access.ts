import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { artifact, artifactSave, session } from '@/db/schema';
import { sessionVisibleToViewer } from '@/features/sessions/api/session-visibility';
import { AppError } from '@/lib/errors';
import { viewerSave } from './artifact-transitions';

// Missing artifacts and inaccessible source tasks share one 404 so existence never leaks.
// `savedDriveFileId` is the viewer's own Library copy, never a teammate's.

export type OwnedArtifact = {
  id: string;
  sessionId: string;
  anthropicFileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadable: boolean;
  savedDriveFileId: string | null;
};

export async function loadOwnedArtifact(input: {
  artifactId: string;
  workspaceId: string;
  viewerId: string;
}): Promise<OwnedArtifact> {
  const row = (
    await db
      .select({
        id: artifact.id,
        sessionId: artifact.sessionId,
        anthropicFileId: artifact.anthropicFileId,
        filename: artifact.filename,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        downloadable: artifact.downloadable,
        savedDriveFileId: artifactSave.fileId,
      })
      .from(artifact)
      .innerJoin(session, eq(artifact.sessionId, session.id))
      .leftJoin(artifactSave, viewerSave(input.viewerId))
      .where(
        and(
          eq(artifact.id, input.artifactId),
          eq(artifact.workspaceId, input.workspaceId),
          sessionVisibleToViewer(input.viewerId),
          isNull(session.hiddenAt),
        ),
      )
      .limit(1)
  ).at(0);

  if (!row) {
    throw new AppError('ARTIFACT_NOT_FOUND', 'Artifact not found', {
      artifactId: input.artifactId,
      workspaceId: input.workspaceId,
    });
  }
  return row;
}
