'use server';

import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db';
import { file, folder, folderShare } from '@/db/schema';
import { runAction } from '@/lib/action-state';
import { captureEvent } from '@/lib/analytics';
import { resolveCaller } from '@/lib/caller';
import { env } from '@/lib/env';
import { AppError, AuthorizationError } from '@/lib/errors';
import { generateShareToken, type ShareState } from '@/lib/share-token';
import { roleIsAtLeast } from '@/lib/workspace-role';
import { FILES_ACTION } from '../constants';
import {
  createShareInput,
  parseActionInput,
  shareIdInput,
  shareTargetInput,
} from '../lib/action-input';
import {
  CHAT_UPLOADS_FOLDER_PATH,
  isValidFolderPath,
  normalizeFolderPath,
  ROOT,
} from '../lib/paths';
import { fileVisibleTo, folderWritableBy, requireWritableFolder } from '../lib/team-folder';
import type { ActionResult, ShareMode, ShareSummary, ShareTarget } from '../types';
import { selectShares, shareGrantRefusal, shareLinkState, withCreatorRole } from './live-share';
import { createShareRow, revokeShares } from './share-transitions';

// Share links target one visible file or an existing folder the caller may write to.

function shareUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/share/${token}`;
}

function toSummary(
  row: Pick<typeof folderShare.$inferSelect, 'id' | 'fileId' | 'mode' | 'createdAt'> & {
    folderPath: string;
  },
  state: ShareState,
  canRevoke: boolean,
): ShareSummary {
  return {
    id: row.id,
    canRevoke,
    fileId: row.fileId,
    folderPath: row.folderPath,
    mode: row.mode,
    state,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Create a share link for a file or folder. `expiresInDays` null = never expires. */
export async function createShare(request: {
  target: ShareTarget;
  mode: ShareMode;
  expiresInDays: number | null;
}): Promise<ActionResult<{ token: string; url: string; share: ShareSummary }>> {
  return runAction({ ...FILES_ACTION, route: 'files/shares/create', op: 'create' }, async () => {
    const input = parseActionInput(createShareInput, request, 'invalid share link request');
    const { workspaceId, userId, role } = await resolveCaller(await headers());
    const target = input.target;
    const sharedFile =
      target.kind === 'file'
        ? await requireShareableFile(workspaceId, userId, target.fileId)
        : null;
    if (target.kind === 'file' && input.mode !== 'view') {
      throw new AppError('TOOL_INPUT_INVALID', 'file links are view-only', {});
    }
    const folderPath =
      target.kind === 'folder'
        ? normalizeFolderPath(target.folderPath)
        : (sharedFile?.folderPath ?? null);
    if (folderPath === null || !isValidFolderPath(folderPath)) {
      throw new AppError('TOOL_INPUT_INVALID', 'invalid folder path', { input });
    }

    const grant = {
      userId,
      role,
      mode: input.mode,
      isFolderLink: target.kind === 'folder',
      folderPath,
    };
    if (shareGrantRefusal({ ...grant, folderCreatorUserId: null }) === 'root_requires_admin') {
      throw new AuthorizationError('Only workspace admins can share the root folder', {
        workspaceId,
      });
    }
    let folderCreatorUserId: string | null = null;
    let folderId: string | null = null;
    if (target.kind === 'folder' && folderPath !== ROOT) {
      // Navigating a teammate's folder that holds one of my files does not let me share it.
      const exists = (
        await db
          .select({ id: folder.id, createdByUserId: folder.createdByUserId })
          .from(folder)
          .where(
            and(
              eq(folder.workspaceId, workspaceId),
              eq(folder.path, folderPath),
              isNull(folder.deletedAt),
              folderWritableBy(userId),
            ),
          )
          .limit(1)
      ).at(0);
      if (!exists) {
        throw new AppError('TOOL_INPUT_INVALID', 'folder not found', { folderPath });
      }
      folderCreatorUserId = exists.createdByUserId;
      folderId = exists.id;
    }

    if (shareGrantRefusal({ ...grant, folderCreatorUserId }) !== null) {
      throw new AuthorizationError(
        'Only workspace owners, admins, and the folder creator can create edit links',
        { workspaceId, folderPath, userId, role },
      );
    }

    let expiresAt: Date | null = null;
    if (input.expiresInDays !== null) {
      if (!Number.isFinite(input.expiresInDays) || input.expiresInDays <= 0) {
        throw new AppError('TOOL_INPUT_INVALID', 'expiry must be a positive number of days', {
          expiresInDays: input.expiresInDays,
        });
      }
      expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    }

    const token = generateShareToken();
    const row = await createShareRow({
      workspaceId,
      folderId,
      fileId: sharedFile?.id ?? null,
      mode: input.mode,
      token,
      expiresAt,
      createdByUserId: userId,
    });
    captureEvent('share:create', {
      share_kind: target.kind === 'file' ? 'file_link' : 'folder_link',
      share_id: row.id,
      share_mode: input.mode,
      has_expiry: Boolean(expiresAt),
    });
    return { token, url: shareUrl(token), share: toSummary({ ...row, folderPath }, 'live', true) };
  });
}

/** Revoke a share immediately (sets revoked_at = now). */
export async function revokeShare(id: string): Promise<ActionResult<undefined>> {
  return runAction({ ...FILES_ACTION, route: 'files/shares/revoke', op: 'revoke' }, async () => {
    const shareId = parseActionInput(shareIdInput, id, 'link not found');
    const { workspaceId, userId, role } = await resolveCaller(await headers());
    const revoked = await revokeShares(
      db,
      and(
        eq(folderShare.id, shareId),
        eq(folderShare.workspaceId, workspaceId),
        ...(roleIsAtLeast(role, 'admin') ? [] : [eq(folderShare.createdByUserId, userId)]),
      ),
    );
    if (revoked.length === 0) {
      const existing = (
        await db
          .select({ revokedAt: folderShare.revokedAt })
          .from(folderShare)
          .where(and(eq(folderShare.id, shareId), eq(folderShare.workspaceId, workspaceId)))
          .limit(1)
      ).at(0);
      if (!existing || existing.revokedAt === null) {
        throw new AuthorizationError('Only the link creator or an admin can revoke this link', {
          shareId,
        });
      }
    }
    return undefined;
  });
}

/** List links for exactly this target, most recent first. */
export async function listShares(request: ShareTarget): Promise<ActionResult<ShareSummary[]>> {
  return runAction({ ...FILES_ACTION, route: 'files/shares/list', op: 'list' }, async () => {
    const target = parseActionInput(shareTargetInput, request, 'invalid share target');
    const { workspaceId, userId, role } = await resolveCaller(await headers());
    let condition: SQL | undefined;
    if (target.kind === 'file') {
      await requireShareableFile(workspaceId, userId, target.fileId);
      condition = eq(folderShare.fileId, target.fileId);
    } else {
      const path = normalizeFolderPath(target.folderPath);
      if (path === null) throw new AppError('TOOL_INPUT_INVALID', 'invalid folder path', {});
      if (path === ROOT) {
        if (!roleIsAtLeast(role, 'admin'))
          throw new AuthorizationError('Only workspace admins can list root links', {
            workspaceId,
          });
      } else {
        await requireWritableFolder(workspaceId, userId, path);
      }
      condition = and(
        isNull(folderShare.fileId),
        path === ROOT ? isNull(folderShare.folderId) : eq(folder.path, path),
        ...(path === CHAT_UPLOADS_FOLDER_PATH && !roleIsAtLeast(role, 'admin')
          ? [eq(folderShare.createdByUserId, userId)]
          : []),
      );
    }
    const rows = await selectShares(db)
      .where(and(eq(folderShare.workspaceId, workspaceId), condition))
      .orderBy(desc(folderShare.createdAt));
    const now = new Date();
    return rows.map((row) =>
      toSummary(
        row,
        shareLinkState(withCreatorRole(row), now),
        roleIsAtLeast(role, 'admin') || row.createdByUserId === userId,
      ),
    );
  });
}

async function requireShareableFile(workspaceId: string, userId: string, fileId: string) {
  const row = (
    await db
      .select({ id: file.id, folderPath: file.folderPath })
      .from(file)
      .where(
        and(
          eq(file.id, fileId),
          eq(file.workspaceId, workspaceId),
          isNull(file.deletedAt),
          fileVisibleTo(userId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!row) throw new AuthorizationError('File is not available to share', { workspaceId, fileId });
  return row;
}
