import 'server-only';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { artifact, artifactSave, session } from '@/db/schema';
import { sessionVisibleToViewer } from '@/features/sessions/api/session-visibility';
import type { ArtifactSessionGroup, ArtifactSummary } from '../types';
import { viewerSave } from './artifact-transitions';

// Read projections over the artifact mirror. Chat lists one session's outputs;
// the /knowledge/artifacts library lists the whole workspace's, grouped under
// each artifact's source session (title + date).

type ArtifactRow = {
  id: string;
  anthropicFileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadable: boolean;
  savedDriveFileId: string | null;
  fileCreatedAt: Date;
};

function toSummary(row: ArtifactRow): ArtifactSummary {
  return {
    id: row.id,
    anthropicFileId: row.anthropicFileId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    downloadable: row.downloadable,
    savedDriveFileId: row.savedDriveFileId,
    createdAt: row.fileCreatedAt.toISOString(),
  };
}

/** A session's artifacts, oldest first (matches transcript order). */
export async function listSessionArtifacts(input: {
  anthropicSessionId: string;
  workspaceId: string;
  viewerId: string;
}): Promise<ArtifactSummary[]> {
  const rows = await db
    .select({
      id: artifact.id,
      anthropicFileId: artifact.anthropicFileId,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      downloadable: artifact.downloadable,
      savedDriveFileId: artifactSave.fileId,
      fileCreatedAt: artifact.fileCreatedAt,
    })
    .from(artifact)
    .innerJoin(session, eq(artifact.sessionId, session.id))
    .leftJoin(artifactSave, viewerSave(input.viewerId))
    .where(
      and(
        eq(session.anthropicSessionId, input.anthropicSessionId),
        eq(artifact.workspaceId, input.workspaceId),
        sessionVisibleToViewer(input.viewerId),
        isNull(session.hiddenAt),
      ),
    )
    .orderBy(asc(artifact.fileCreatedAt));
  return rows.map(toSummary);
}

/**
 * Every artifact in the workspace, grouped by source session, newest session
 * first; artifacts inside a group stay in creation order.
 */
export async function listWorkspaceArtifacts(input: {
  workspaceId: string;
  viewerId: string;
}): Promise<ArtifactSessionGroup[]> {
  const rows = await db
    .select({
      id: artifact.id,
      anthropicFileId: artifact.anthropicFileId,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      downloadable: artifact.downloadable,
      savedDriveFileId: artifactSave.fileId,
      fileCreatedAt: artifact.fileCreatedAt,
      sessionRowId: session.id,
      anthropicSessionId: session.anthropicSessionId,
      title: session.title,
      sessionCreatedAt: session.createdAt,
    })
    .from(artifact)
    .innerJoin(session, eq(artifact.sessionId, session.id))
    .leftJoin(artifactSave, viewerSave(input.viewerId))
    .where(
      and(
        eq(artifact.workspaceId, input.workspaceId),
        sessionVisibleToViewer(input.viewerId),
        isNull(session.hiddenAt),
      ),
    )
    .orderBy(desc(session.createdAt), asc(artifact.fileCreatedAt));

  const groups = new Map<string, ArtifactSessionGroup>();
  for (const row of rows) {
    let group = groups.get(row.sessionRowId);
    if (!group) {
      group = {
        sessionRowId: row.sessionRowId,
        anthropicSessionId: row.anthropicSessionId,
        title: row.title,
        sessionCreatedAt: row.sessionCreatedAt.toISOString(),
        artifacts: [],
      };
      groups.set(row.sessionRowId, group);
    }
    group.artifacts.push(toSummary(row));
  }
  return [...groups.values()];
}
