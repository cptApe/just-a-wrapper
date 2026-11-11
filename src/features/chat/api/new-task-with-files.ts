'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db';
import { file, folder } from '@/db/schema';
import { FILES_ACTION } from '@/features/files/constants';
import { basename, normalizeFolderPath } from '@/features/files/lib/paths';
import { fileVisibleTo, folderVisibleTo } from '@/features/files/lib/team-folder';
import type { ActionResult } from '@/features/files/types';
import { startChatSession } from '@/features/session-runtime';
import { LIBRARY_READ_INSTRUCTION } from '@/features/sessions/lib/build-composer-message';
import { dispatchSessionActions } from '@/features/tools/api/dispatch-session-actions';
import { runAction } from '@/lib/action-state';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { fileContentUrl } from '@/lib/file-content-url';

// New task carries Library selections as references, without copying to the sandbox.
// Use the same attached_files syntax as build-composer-message so chips render
// consistently. The agent reads file references with read_library_file and lists folder paths.

const taskSelectionSchema = z.object({
  fileIds: z.array(z.string().uuid()).max(20),
  folderPaths: z.array(z.string()).max(20),
});

export async function newTaskWithFiles(
  fileIds: string[],
  folderPaths: string[],
  expectedOrganizationId: string,
): Promise<ActionResult<{ sessionId: string }>> {
  return runAction({ ...FILES_ACTION, route: 'files/new-task', op: 'create' }, async () => {
    const ctx = await resolveCaller(await headers());
    assertExpectedOrganization(ctx.organizationId, expectedOrganizationId);
    const parsed = taskSelectionSchema.safeParse({ fileIds, folderPaths });
    if (!parsed.success) {
      throw new AppError(
        'TOOL_INPUT_INVALID',
        'Invalid task selection',
        {},
        { cause: parsed.error },
      );
    }
    const { fileIds: fileIdList, folderPaths: folderInput } = parsed.data;
    if (fileIdList.length === 0 && folderInput.length === 0) {
      throw new AppError('TOOL_INPUT_INVALID', 'attach at least one file or folder', {});
    }

    // Files → durable URLs, workspace-scoped (a foreign id simply matches nothing).
    const rows = fileIdList.length
      ? await db
          .select({
            filename: file.filename,
            id: file.id,
          })
          .from(file)
          .where(
            and(
              eq(file.workspaceId, ctx.workspaceId),
              fileVisibleTo(ctx.userId),
              isNull(file.deletedAt),
              inArray(file.id, fileIdList),
            ),
          )
      : [];

    // Reject malformed paths and folders missing from the active workspace
    // instead of attaching dead references.
    const normalizedFolders = folderInput.map((path) => {
      const normalized = normalizeFolderPath(path);
      if (normalized === null)
        throw new AppError('TOOL_INPUT_INVALID', 'invalid folder path attached', {});
      return normalized;
    });
    const requestedFolderPaths = [...new Set(normalizedFolders)];
    if (requestedFolderPaths.length > 0) {
      const live = await db
        .select({ path: folder.path })
        .from(folder)
        .where(
          and(
            eq(folder.workspaceId, ctx.workspaceId),
            isNull(folder.deletedAt),
            folderVisibleTo(ctx.userId),
            inArray(folder.path, requestedFolderPaths),
          ),
        );
      const livePaths = new Set(live.map((f) => f.path));
      const missing = requestedFolderPaths.filter((p) => !livePaths.has(p));
      if (missing.length > 0) {
        throw new AppError('TOOL_INPUT_INVALID', 'some attached folders do not exist', { missing });
      }
    }
    const folders = requestedFolderPaths.map((path) => ({ path, name: basename(path) }));

    if (rows.length === 0 && folders.length === 0) {
      throw new AppError('TOOL_INPUT_INVALID', 'no matching files or folders', {});
    }

    // Byte-identical to build-composer-message.ts — the client parser depends on it.
    const fileLines = rows.map((r) => `${r.filename} — ${fileContentUrl(r.id, null)}`);
    const folderLines = folders.map((f) => `${f.name}/ (folder) — Library folder ${f.path}`);
    const block = `<attached_files>\n${[...fileLines, ...folderLines, LIBRARY_READ_INSTRUCTION].join('\n')}\n</attached_files>`;

    const count = rows.length + folders.length;
    const names = [...rows.map((r) => r.filename), ...folders.map((f) => `${f.name}/`)].join(', ');
    const humanText =
      count === 1
        ? `I've attached an item from my Library: ${names}. Take a look. I'll tell you what I need.`
        : `I've attached ${count} items from my Library: ${names}. Take a look. I'll tell you what I need.`;

    // startChatSession runs the spend gate and the chats-at-once limit before the upstream
    // create; the action result carries the refusal code and the pane toasts it.
    const { sessionId } = await startChatSession({
      tier: 'default',
      kind: 'chat',
      permissionMode: 'auto',
      deferInitialMessage: false,
      message: `${humanText}\n\n${block}`,
      workspaceId: ctx.workspaceId,
      createdByUserId: ctx.userId,
      organizationId: ctx.organizationId,
      dispatchPendingToolCalls: dispatchSessionActions,
    });

    return { sessionId };
  });
}
