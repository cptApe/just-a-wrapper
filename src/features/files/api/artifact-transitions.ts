import 'server-only';
import type { FileMetadata } from '@anthropic-ai/sdk/resources/beta/files';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { artifact, artifactSave, file } from '@/db/schema';

/**
 * Record `fileId` as this person's Library copy of the artifact. The first copy
 * wins: a second save, or a race, returns the copy already recorded. Null when
 * the file is gone or belongs to another workspace than the artifact.
 */
export async function claimArtifactSave(input: {
  artifactId: string;
  userId: string;
  fileId: string;
}): Promise<{ fileId: string; storagePath: string } | null> {
  return db.transaction(async (tx) => {
    const target = (
      await tx
        .select({ id: file.id })
        .from(file)
        .innerJoin(artifact, eq(artifact.workspaceId, file.workspaceId))
        .where(
          and(eq(file.id, input.fileId), eq(artifact.id, input.artifactId), isNull(file.deletedAt)),
        )
        .for('update', { of: file })
    ).at(0);
    if (!target) return null;
    await tx
      .insert(artifactSave)
      .values({ artifactId: input.artifactId, userId: input.userId, fileId: input.fileId })
      .onConflictDoNothing();
    const saved = (
      await tx
        .select({ fileId: file.id, storagePath: file.storagePath })
        .from(artifactSave)
        .innerJoin(file, eq(file.id, artifactSave.fileId))
        .where(
          and(eq(artifactSave.artifactId, input.artifactId), eq(artifactSave.userId, input.userId)),
        )
    ).at(0);
    return saved ?? null;
  });
}

/** Join condition for the viewer's own save of `artifact`; select `artifactSave.fileId`. */
export function viewerSave(viewerId: string) {
  return and(eq(artifactSave.artifactId, artifact.id), eq(artifactSave.userId, viewerId));
}

export async function unlinkSavedFiles(connection: DbTransaction | typeof db, fileIds: string[]) {
  return connection
    .delete(artifactSave)
    .where(inArray(artifactSave.fileId, fileIds))
    .returning({ artifactId: artifactSave.artifactId });
}

export async function mirrorArtifacts(
  scope: { workspaceId: string; sessionId: string },
  files: FileMetadata[],
) {
  if (files.length === 0) return 0;
  const inserted = await db
    .insert(artifact)
    .values(
      Array.from(new Map(files.map((meta) => [meta.id, meta])).values()).map((meta) => ({
        ...scope,
        anthropicFileId: meta.id,
        filename: meta.filename,
        mimeType: meta.mime_type,
        sizeBytes: meta.size_bytes,
        downloadable: meta.downloadable === true,
        fileCreatedAt: new Date(meta.created_at),
      })),
    )
    .onConflictDoUpdate({
      target: artifact.anthropicFileId,
      set: {
        filename: sql`excluded.filename`,
        mimeType: sql`excluded.mime_type`,
        sizeBytes: sql`excluded.size_bytes`,
        downloadable: sql`excluded.downloadable`,
        fileCreatedAt: sql`excluded.file_created_at`,
      },
      setWhere: sql`(${artifact.filename}, ${artifact.mimeType}, ${artifact.sizeBytes}, ${artifact.downloadable}, ${artifact.fileCreatedAt}) is distinct from (excluded.filename, excluded.mime_type, excluded.size_bytes, excluded.downloadable, excluded.file_created_at)`,
    })
    .returning({ inserted: sql<boolean>`xmax = 0` });
  return inserted.filter((row) => row.inserted).length;
}
