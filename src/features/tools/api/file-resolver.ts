import 'server-only';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { file } from '@/db/schema';
import { findVisibleLibraryFile } from '@/features/files/api/library-operations';
import { MAX_SESSION_MOUNT_BYTES } from '@/features/files/lib/limits';
import { joinPath, splitStoragePath } from '@/features/files/lib/paths';
import { fileVisibleTo } from '@/features/files/lib/team-folder';
import { ToolError } from '@/lib/errors';
import { parseFileContentUrl } from '@/lib/file-content-url';
import { resolveLibraryItemPath } from '../lib/library-file';
import {
  attachmentName,
  latestKind,
  matchesFileKind,
  type ResolvedToolFile,
  SESSION_FILE_LIMIT,
  type ToolFileContext,
  type ToolFileReference,
} from '../lib/registered-tool-files';
import { readResponseBytes } from './read-tool-file-bytes';
import { downloadSessionOutput } from './session-output';

async function fromLibraryRow(
  row: {
    id: string;
    filename: string;
    folderPath: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
  },
  foundIn: ResolvedToolFile['foundIn'],
  workspaceId: string,
): Promise<ResolvedToolFile> {
  if (!splitStoragePath(workspaceId, row.storagePath)) {
    throw new ToolError('TOOL_INPUT_INVALID', 'This Library file has an invalid storage path.', {
      fileId: row.id,
    });
  }
  return {
    foundIn,
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    libraryPath: joinPath(row.folderPath, row.filename),
    source: { kind: 'blob', storagePath: row.storagePath, fileId: row.id },
  };
}

async function findLibraryPath(
  path: string,
  ctx: ToolFileContext,
): Promise<ResolvedToolFile | null> {
  const resolved = resolveLibraryItemPath(path);
  if (resolved.message) return null;
  const row = await findVisibleLibraryFile(ctx, resolved.path);
  return row ? fromLibraryRow(row, 'library', ctx.workspaceId) : null;
}

async function findChatAttachment(
  reference: string,
  ctx: ToolFileContext,
): Promise<ResolvedToolFile | null> {
  const name = attachmentName(reference);
  const rows = await db
    .select({
      id: file.id,
      filename: file.filename,
      folderPath: file.folderPath,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      storagePath: file.storagePath,
    })
    .from(file)
    .where(
      and(
        eq(file.workspaceId, ctx.workspaceId),
        eq(file.sessionId, ctx.sessionRowId),
        eq(file.source, 'user_upload'),
        eq(file.filename, name),
        isNull(file.deletedAt),
        fileVisibleTo(ctx.userId),
      ),
    )
    .orderBy(desc(file.createdAt))
    .limit(2);
  if (rows.length > 1)
    throw new ToolError(
      'TOOL_INPUT_INVALID',
      'Several attachments have this name. Use a file URL.',
      { name },
    );
  const row = rows.at(0);
  return row ? fromLibraryRow(row, 'chat_attachment', ctx.workspaceId) : null;
}

async function findSessionOutput(
  name: string,
  ctx: ToolFileContext,
  { sweepOnMiss }: { sweepOnMiss: boolean },
): Promise<ResolvedToolFile | null> {
  const output = await downloadSessionOutput({
    sessionRowId: ctx.sessionRowId,
    anthropicSessionId: ctx.sessionId,
    filename: name,
    viewerId: ctx.userId,
    maxBytes: MAX_SESSION_MOUNT_BYTES,
    sweepOnMiss,
  });
  if (!output) return null;
  if (output.sizeBytes > MAX_SESSION_MOUNT_BYTES) {
    await output.response.body?.cancel();
    throw new ToolError('TOOL_INPUT_INVALID', 'The file exceeds the read limit.', {
      filename: output.filename,
      sizeBytes: output.sizeBytes,
      maxBytes: MAX_SESSION_MOUNT_BYTES,
    });
  }
  if (output.savedDriveFileId) {
    const saved = await findVisibleFileById(output.savedDriveFileId, ctx);
    if (saved) {
      await output.response.body?.cancel();
      return {
        ...(await fromLibraryRow(saved, 'session_output', ctx.workspaceId)),
        sessionArtifactId: output.artifactId,
      };
    }
  }
  const bytes = await readResponseBytes(output.response, output.filename, MAX_SESSION_MOUNT_BYTES);
  return {
    foundIn: 'session_output',
    filename: output.filename,
    mimeType: output.mimeType,
    sizeBytes: output.sizeBytes,
    sessionArtifactId: output.artifactId,
    source: { kind: 'bytes', bytes },
  };
}

type LibraryRow = {
  id: string;
  filename: string;
  folderPath: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

async function findVisibleFileById(
  fileId: string,
  ctx: ToolFileContext,
): Promise<LibraryRow | null> {
  const row = (
    await db
      .select({
        id: file.id,
        filename: file.filename,
        folderPath: file.folderPath,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        storagePath: file.storagePath,
      })
      .from(file)
      .where(
        and(
          eq(file.id, fileId),
          eq(file.workspaceId, ctx.workspaceId),
          isNull(file.deletedAt),
          fileVisibleTo(ctx.userId),
        ),
      )
      .limit(1)
  ).at(0);
  return row ?? null;
}

async function findToolOutput(
  reference: string,
  ctx: ToolFileContext,
): Promise<ResolvedToolFile | null> {
  const rows = await db
    .select({
      id: file.id,
      filename: file.filename,
      folderPath: file.folderPath,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      storagePath: file.storagePath,
    })
    .from(file)
    .where(
      and(
        eq(file.workspaceId, ctx.workspaceId),
        eq(file.sessionId, ctx.sessionRowId),
        inArray(file.source, ['agent_generated', 'session_output']),
        isNull(file.deletedAt),
        fileVisibleTo(ctx.userId),
      ),
    )
    .orderBy(desc(file.createdAt), desc(file.id))
    .limit(SESSION_FILE_LIMIT);
  const kind = latestKind(reference);
  const row = rows.find((candidate) => {
    if (kind) return matchesFileKind(candidate.mimeType, kind);
    return (
      candidate.id === reference ||
      candidate.filename === reference ||
      joinPath(candidate.folderPath, candidate.filename) === reference
    );
  });
  if (row) return fromLibraryRow(row, 'tool_output', ctx.workspaceId);
  return null;
}

type FileLookup = { kind: 'library_path' | 'name' | 'url'; value: string };

// Every tool's input schema accepts exactly one reference field, so one branch applies.
function readFileLookup(reference: ToolFileReference): FileLookup | null {
  if (reference.libraryPath) return { kind: 'library_path', value: reference.libraryPath };
  if (reference.url) return { kind: 'url', value: reference.url };
  const name = reference.name ?? reference.outputFilename;
  if (!name) return null;
  return { kind: isHttpReference(name) || parseFileContentUrl(name) ? 'url' : 'name', value: name };
}

function isHttpReference(reference: string): boolean {
  return /^https?:\/\//i.test(reference.trim());
}

function urlResult(rawUrl: string): ResolvedToolFile | null {
  if (!URL.canParse(rawUrl)) return null;
  if (new URL(rawUrl).protocol !== 'https:') {
    throw new ToolError('TOOL_INPUT_INVALID', 'Only https links are supported.', { url: rawUrl });
  }
  const url = new URL(rawUrl);
  let filename: string;
  try {
    filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? 'file');
  } catch (cause) {
    throw new ToolError(
      'TOOL_INPUT_INVALID',
      'The file URL contains an invalid filename.',
      { url: rawUrl },
      { cause },
    );
  }
  return {
    foundIn: 'url',
    filename,
    mimeType: '',
    source: { kind: 'url', url: url.toString() },
  };
}

export async function resolveToolFile(
  reference: ToolFileReference,
  ctx: ToolFileContext,
): Promise<ResolvedToolFile> {
  const lookup = readFileLookup(reference);
  const found = lookup ? await findFile(lookup, ctx) : null;
  if (found) return found;
  const display = lookup ? lookup.value : 'file';
  throw new ToolError(
    'TOOL_INPUT_INVALID',
    `No file named "${display}" in this chat's attachments, the Library, or this session's outputs.`,
    { reference: display },
  );
}

function findFile(lookup: FileLookup, ctx: ToolFileContext): Promise<ResolvedToolFile | null> {
  switch (lookup.kind) {
    case 'library_path':
      return findLibraryPathOutsideUploads(lookup.value, ctx);
    case 'name':
      return findByName(lookup.value, ctx);
    case 'url':
      return findByUrl(lookup.value, ctx);
  }
}

async function findLibraryPathOutsideUploads(
  path: string,
  ctx: ToolFileContext,
): Promise<ResolvedToolFile | null> {
  return path.startsWith('/mnt/session/uploads/') ? null : findLibraryPath(path, ctx);
}

// A bare name can mean any of these places. The artifact sweep calls the provider, so it runs last.
async function findByName(name: string, ctx: ToolFileContext): Promise<ResolvedToolFile | null> {
  const inLibrary = await findLibraryPathOutsideUploads(name, ctx);
  if (inLibrary) return inLibrary;
  const attachment = await findChatAttachment(name, ctx);
  if (attachment) return attachment;
  const output = await findSessionOutput(name, ctx, { sweepOnMiss: false });
  if (output) return output;
  const produced = await findToolOutput(name, ctx);
  if (produced) return produced;
  return findSessionOutput(name, ctx, { sweepOnMiss: true });
}

async function findByUrl(url: string, ctx: ToolFileContext): Promise<ResolvedToolFile | null> {
  const parsed = parseFileContentUrl(url);
  if (!parsed) return urlResult(url);
  const row = await findVisibleFileById(parsed.fileId, ctx);
  const stored = row ? await fromLibraryRow(row, 'library', ctx.workspaceId) : null;
  if (!stored)
    throw new ToolError('TOOL_INPUT_INVALID', 'File is not available.', {
      fileId: parsed.fileId,
    });
  return stored;
}
