import 'server-only';
import { toFile } from '@anthropic-ai/sdk';
import { z } from 'zod';
import { requireAnthropicClient } from '@/features/agents';
import { importDriveFile } from '@/features/files/api/import-drive-file';
import {
  deleteVisibleLibraryItem,
  ensureLibraryFolderPath,
  findVisibleLibraryFile,
  moveVisibleLibraryItem,
  visibleLibraryMountFilename,
} from '@/features/files/api/library-operations';
import { loadFilesPage } from '@/features/files/api/load';
import { recordSessionFileMount } from '@/features/files/api/session-file-mounts';
import { MAX_SESSION_MOUNT_BYTES } from '@/features/files/lib/limits';
import { isValidSegment, joinPath, normalizeFolderPath, ROOT } from '@/features/files/lib/paths';
import { MAX_TOOL_TEXT_CHARS } from '@/features/tool-catalog/lib/text-limits';
import {
  CREATE_LIBRARY_FOLDER_DECL,
  DELETE_LIBRARY_ITEM_DECL,
  MOVE_LIBRARY_ITEM_DECL,
  READ_LIBRARY_FILE_DECL,
  SAVE_TO_LIBRARY_DECL,
  SEARCH_LIBRARY_DECL,
} from '@/features/tool-catalog/library-declarations';
import type { CustomTool } from '@/features/tool-catalog/types';
import { IntegrationError, ToolError } from '@/lib/errors';
import { formatBytes } from '@/lib/format/format-bytes';
import { captureException } from '@/lib/observability';
import { resolveToolFile } from '../api/file-resolver';
import { readToolFileBytes } from '../api/read-tool-file-bytes';
import { isTextLikeMime, mimeForTextFilename } from '../lib/library-file';
import { type ResolvedToolFile } from '../lib/registered-tool-files';

const MAX_INLINE_BYTES = 256 * 1024;
const FILE_BETAS: Array<'files-api-2025-04-14' | 'managed-agents-2026-04-01'> = [
  'files-api-2025-04-14',
  'managed-agents-2026-04-01',
];
const typeFacet = z.enum(['documents', 'images', 'pdfs', 'spreadsheets', 'presentations']);

const searchInput = z.object({ query: z.string().min(1).max(2000), type: typeFacet.optional() });
const searchOutput = z.object({
  results: z.array(
    z.object({
      path: z.string(),
      name: z.string(),
      mimeType: z.string(),
      size: z.number(),
    }),
  ),
  truncated: z.boolean(),
  message: z.string().optional(),
});
export const searchLibraryTool: CustomTool<
  z.infer<typeof searchInput>,
  z.infer<typeof searchOutput>
> = {
  ...SEARCH_LIBRARY_DECL,
  inputSchema: searchInput,
  outputSchema: searchOutput,
  async handler({ query, type }, ctx) {
    const page = await loadFilesPage(ctx.workspaceId, ctx.userId, {
      path: ROOT,
      type: type ?? null,
      q: query,
      trash: false,
      sort: 'name',
      dir: 'asc',
      offset: 0,
    });
    const results = page.files.map((row) => ({
      path: joinPath(row.folderPath, row.filename),
      name: row.filename,
      mimeType: row.mimeType,
      size: row.sizeBytes,
    }));
    return {
      results,
      truncated: page.hasMore,
      ...(results.length === 0 ? { message: `No Library files match "${query}".` } : {}),
    };
  },
};

const readInput = z.object({ path: z.string() });
const readOutput = z.object({
  path: z.string(),
  delivery: z.enum(['inline', 'mounted', 'missing']),
  text: z.string().optional(),
  mountedPath: z.string().optional(),
  truncated: z.boolean().optional(),
  message: z.string().optional(),
});
export const readLibraryFileTool: CustomTool<
  z.infer<typeof readInput>,
  z.infer<typeof readOutput>
> = {
  ...READ_LIBRARY_FILE_DECL,
  inputSchema: readInput,
  outputSchema: readOutput,
  async handler({ path: rawPath }, ctx) {
    let resolved: ResolvedToolFile;
    let bytes: Uint8Array<ArrayBuffer>;
    let mimeType: string;
    try {
      resolved = await resolveToolFile({ name: rawPath }, ctx);
      if (resolved.sizeBytes && resolved.sizeBytes > MAX_SESSION_MOUNT_BYTES) {
        return {
          path: resolved.libraryPath ?? rawPath,
          delivery: 'missing',
          message: `This file is ${formatBytes(resolved.sizeBytes)} and exceeds the 25 MB read limit.`,
        };
      }
      const materialized = await readToolFileBytes(resolved, MAX_SESSION_MOUNT_BYTES);
      bytes = materialized.bytes;
      mimeType = resolved.mimeType || materialized.mimeType;
    } catch (cause) {
      if (cause instanceof ToolError) {
        return { path: rawPath.trim(), delivery: 'missing', message: cause.message };
      }
      throw cause;
    }
    const resolvedPath = resolved.libraryPath ?? rawPath;
    if (isTextLikeMime(mimeType)) {
      const full = new TextDecoder().decode(bytes);
      const truncated = full.length > MAX_TOOL_TEXT_CHARS;
      return {
        path: resolvedPath,
        delivery: 'inline',
        text: truncated ? `${full.slice(0, MAX_TOOL_TEXT_CHARS).trimEnd()}…` : full,
        truncated,
      };
    }

    const client = requireAnthropicClient();
    const uploaded = await client.beta.files.upload({
      file: await toFile(
        bytes,
        `agentcore_${ctx.sessionRowId}_${resolved.source.kind === 'blob' ? resolved.source.fileId : 'none'}_${resolved.filename}`,
        { type: mimeType },
      ),
      betas: FILE_BETAS,
    });
    try {
      await recordSessionFileMount({
        anthropicFileId: uploaded.id,
        fileId: resolved.source.kind === 'blob' ? resolved.source.fileId : null,
        sessionId: ctx.sessionRowId,
        workspaceId: ctx.workspaceId,
      });
    } catch (cause) {
      try {
        await client.beta.files.delete(uploaded.id, { betas: FILE_BETAS });
      } catch (cleanupCause) {
        captureException(cleanupCause, {
          feature: 'files',
          op: 'untracked-upload-cleanup',
          anthropicFileId: uploaded.id,
        });
      }
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Could not retain uploaded file identity',
        { anthropicFileId: uploaded.id },
        { cause },
      );
    }
    let mountFilename = resolved.filename;
    if (resolved.foundIn === 'library' && resolved.libraryPath) {
      const row = await findVisibleLibraryFile(ctx, resolved.libraryPath);
      if (row) mountFilename = await visibleLibraryMountFilename(ctx, row);
    }
    const mountedPath = `/mnt/session/uploads/${mountFilename}`;
    await client.beta.sessions.resources.add(ctx.sessionId, {
      type: 'file',
      file_id: uploaded.id,
      mount_path: `/${mountFilename}`,
      betas: FILE_BETAS,
    });
    return { path: resolvedPath, delivery: 'mounted', mountedPath };
  },
};

const saveInput = z
  .object({
    content: z.string().optional(),
    source: z.string().optional(),
    output_filename: z.string().optional(),
    folder_path: z.string(),
    filename: z.string().optional(),
  })
  .superRefine((value, issue) => {
    const sourceCount = [value.content, value.source, value.output_filename].filter(
      (entry) => entry !== undefined,
    ).length;
    if (sourceCount !== 1) {
      issue.addIssue({
        code: 'custom',
        message: 'Provide exactly one of content, source, or output_filename.',
      });
    }
    if (value.content !== undefined && value.filename === undefined) {
      issue.addIssue({
        code: 'custom',
        message: 'filename is required when saving inline content.',
        path: ['filename'],
      });
    }
  });
const saveOutput = z.object({
  path: z.string(),
  url: z.string().optional(),
  message: z.string().optional(),
});
export const saveToLibraryTool: CustomTool<
  z.infer<typeof saveInput>,
  z.infer<typeof saveOutput>
> = {
  ...SAVE_TO_LIBRARY_DECL,
  inputSchema: saveInput,
  outputSchema: saveOutput,
  async handler(input, ctx) {
    const folderPath = normalizeFolderPath(input.folder_path);
    if (folderPath === null)
      throw new ToolError('TOOL_INPUT_INVALID', 'Invalid Library folder path', {
        path: input.folder_path,
      });
    let bytes: Uint8Array<ArrayBuffer>;
    let filename: string;
    let mimeType: string;
    if (input.content !== undefined) {
      bytes = new TextEncoder().encode(input.content);
      if (bytes.byteLength > MAX_INLINE_BYTES)
        throw new ToolError('TOOL_INPUT_INVALID', 'Inline content exceeds 256 KB', {
          sizeBytes: bytes.byteLength,
        });
      if (input.filename === undefined)
        throw new ToolError('TOOL_INPUT_INVALID', 'Inline content requires a filename', {});
      filename = input.filename;
      mimeType = mimeForTextFilename(filename);
    } else {
      let resolved: ResolvedToolFile;
      try {
        resolved = await resolveToolFile(
          input.source ? { name: input.source } : { outputFilename: input.output_filename },
          ctx,
        );
      } catch (cause) {
        if (cause instanceof ToolError) {
          return { path: folderPath, message: cause.message };
        }
        throw cause;
      }
      const materialized = await readToolFileBytes(resolved, MAX_SESSION_MOUNT_BYTES);
      bytes = materialized.bytes;
      filename = input.filename ?? resolved.filename;
      mimeType = materialized.mimeType;
    }
    if (!isValidSegment(filename))
      throw new ToolError('TOOL_INPUT_INVALID', 'Invalid destination filename', { filename });
    await ensureLibraryFolderPath(ctx, folderPath);
    const saved = await importDriveFile({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      bytes,
      filename,
      mimeType,
      folderPath,
      source: input.content !== undefined ? 'agent_generated' : 'session_output',
      sessionId: ctx.sessionRowId,
    });
    return { path: joinPath(saved.folderPath, saved.filename), url: saved.url };
  },
};

const moveInput = z.object({ from_path: z.string(), to_path: z.string() });
const pathOutput = z.object({
  path: z.string(),
  kind: z.enum(['file', 'folder']).optional(),
  message: z.string().optional(),
});
export const moveLibraryItemTool: CustomTool<
  z.infer<typeof moveInput>,
  z.infer<typeof pathOutput>
> = {
  ...MOVE_LIBRARY_ITEM_DECL,
  inputSchema: moveInput,
  outputSchema: pathOutput,
  async handler(input, ctx) {
    const fromPath = normalizeFolderPath(input.from_path);
    const result = await moveVisibleLibraryItem(ctx, input.from_path, input.to_path);
    return (
      result ?? {
        path: fromPath ?? input.from_path.trim(),
        message: `No visible Library item exists at "${fromPath ?? input.from_path.trim()}".`,
      }
    );
  },
};

const folderInput = z.object({ path: z.string() });
export const createLibraryFolderTool: CustomTool<
  z.infer<typeof folderInput>,
  z.infer<typeof pathOutput>
> = {
  ...CREATE_LIBRARY_FOLDER_DECL,
  inputSchema: folderInput,
  outputSchema: pathOutput,
  async handler({ path }, ctx) {
    return { path: await ensureLibraryFolderPath(ctx, path), kind: 'folder' };
  },
};

const deleteOutput = z.object({
  path: z.string(),
  kind: z.enum(['file', 'folder']).optional(),
  removed: z.number().optional(),
  message: z.string().optional(),
});
export const deleteLibraryItemTool: CustomTool<
  z.infer<typeof folderInput>,
  z.infer<typeof deleteOutput>
> = {
  ...DELETE_LIBRARY_ITEM_DECL,
  inputSchema: folderInput,
  outputSchema: deleteOutput,
  async handler({ path }, ctx) {
    const normalized = normalizeFolderPath(path);
    const result = await deleteVisibleLibraryItem(ctx, path);
    return result
      ? {
          path: normalized ?? path.trim(),
          kind: result.kind,
          removed: result.removed,
          message: `Moved "${normalized ?? path.trim()}" to Trash. It is recoverable for 30 days.`,
        }
      : {
          path: normalized ?? path.trim(),
          message: `No visible Library item exists at "${normalized ?? path.trim()}".`,
        };
  },
};
