import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { artifact, artifactSave } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { viewerSave } from '@/features/files/api/artifact-transitions';
import { sweepSessionArtifacts } from '@/features/files/api/sweep-session-artifacts';
import { ARTIFACT_FILE_BETAS } from '@/features/files/constants';
import { ToolError } from '@/lib/errors';
import 'server-only';

export type DownloadedSessionOutput = {
  artifactId: string;
  response: Response;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  savedDriveFileId: string | null;
};

async function findSessionOutput(sessionRowId: string, filename: string, viewerId: string) {
  const rows = await db
    .select({
      id: artifact.id,
      anthropicFileId: artifact.anthropicFileId,
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      savedDriveFileId: artifactSave.fileId,
      sizeBytes: artifact.sizeBytes,
    })
    .from(artifact)
    .leftJoin(artifactSave, viewerSave(viewerId))
    .where(
      and(
        eq(artifact.sessionId, sessionRowId),
        eq(artifact.filename, filename),
        eq(artifact.downloadable, true),
      ),
    )
    .orderBy(desc(artifact.fileCreatedAt))
    .limit(1);
  return rows.at(0);
}

/** Resolve and download a named output, sweeping the session once on a miss. */
export async function downloadSessionOutput(input: {
  sessionRowId: string;
  anthropicSessionId: string;
  filename: string;
  /** Whose Library copy counts as the saved one. */
  viewerId: string;
  maxBytes?: number;
  sweepOnMiss?: boolean;
}): Promise<DownloadedSessionOutput | null> {
  let output = await findSessionOutput(input.sessionRowId, input.filename, input.viewerId);
  if (!output && input.sweepOnMiss !== false) {
    await sweepSessionArtifacts({
      anthropicSessionId: input.anthropicSessionId,
      profile: 'single',
    });
    output = await findSessionOutput(input.sessionRowId, input.filename, input.viewerId);
  }
  if (!output) return null;
  if (input.maxBytes !== undefined && output.sizeBytes > input.maxBytes) {
    throw new ToolError('TOOL_INPUT_INVALID', 'The file exceeds the read limit.', {
      filename: output.filename,
      sizeBytes: output.sizeBytes,
      maxBytes: input.maxBytes,
    });
  }

  const client = requireAnthropicClient();
  const response = await client.beta.files.download(
    output.anthropicFileId,
    { betas: ARTIFACT_FILE_BETAS },
    { signal: AbortSignal.timeout(60_000) },
  );
  return {
    artifactId: output.id,
    response,
    filename: output.filename,
    mimeType: output.mimeType,
    sizeBytes: output.sizeBytes,
    savedDriveFileId: output.savedDriveFileId,
  };
}
