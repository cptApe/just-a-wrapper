import 'server-only';
import { and, eq, getTableColumns, type SQL, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { file, folder, folderShare, member, workspace, workspaceNotDeleted } from '@/db/schema';
import { publicLinkState, type ShareState } from '@/lib/share-token';
import { roleIsAtLeast, type WorkspaceRole, workspaceRoleSchema } from '@/lib/workspace-role';
import { ROOT, TEAM_FOLDER_PATH } from '../lib/paths';
import { fileVisibleTo } from '../lib/team-folder';
import type { ShareMode } from '../types';

export type ShareGrantRefusal = 'root_requires_admin' | 'edit_requires_creator_or_admin';

/**
 * Why `userId` may not hold this link, or null when they may. Creating a link and
 * resolving one both ask, so a role change takes effect on links already handed out.
 */
export function shareGrantRefusal(input: {
  userId: string;
  role: WorkspaceRole | null;
  mode: ShareMode;
  isFolderLink: boolean;
  folderPath: string;
  folderCreatorUserId: string | null;
}): ShareGrantRefusal | null {
  const admin = input.role !== null && roleIsAtLeast(input.role, 'admin');
  if (admin) return null;
  if (input.isFolderLink && input.folderPath === ROOT) return 'root_requires_admin';
  // Only the reserved /Team root is admin-only. Its subfolders keep the normal
  // creator-or-admin rule, so a member may share /Team/projects they created.
  if (
    input.mode === 'edit' &&
    (input.folderPath === TEAM_FOLDER_PATH || input.folderCreatorUserId !== input.userId)
  ) {
    return 'edit_requires_creator_or_admin';
  }
  return null;
}

// One query shape for a link and everything its state depends on, so the share
// dialog and the public resolver read the same facts.
export function selectShares(connection: DbTransaction | typeof db = db) {
  return connection
    .select({
      ...getTableColumns(folderShare),
      workspaceName: workspace.name,
      workspaceLive: sql<boolean>`${workspaceNotDeleted}`,
      creatorRole: member.role,
      folderCreatorUserId: folder.createdByUserId,
      folderPath: sql<string>`case when ${folderShare.fileId} is not null then ${file.folderPath} when ${folderShare.folderId} is not null then ${folder.path} else '/' end`,
    })
    .from(folderShare)
    .innerJoin(workspace, eq(workspace.id, folderShare.workspaceId))
    .leftJoin(
      member,
      and(
        eq(member.organizationId, workspace.organizationId),
        eq(member.userId, folderShare.createdByUserId),
      ),
    )
    .leftJoin(folder, eq(folder.id, folderShare.folderId))
    .leftJoin(file, eq(file.id, folderShare.fileId));
}

export function withCreatorRole<T extends { creatorRole: string | null }>(
  row: T,
): Omit<T, 'creatorRole'> & { creatorRole: WorkspaceRole | null } {
  const role = workspaceRoleSchema.safeParse(row.creatorRole);
  return { ...row, creatorRole: role.success ? role.data : null };
}

export async function loadShare(token: string, connection: DbTransaction | typeof db = db) {
  const row = (await selectShares(connection).where(eq(folderShare.token, token)).limit(1)).at(0);
  return row ? withCreatorRole(row) : undefined;
}

type LoadedShare = NonNullable<Awaited<ReturnType<typeof loadShare>>>;

/** The state a link resolves to now, including whether its creator still holds what it needed. */
export function shareLinkState(share: LoadedShare, now: Date): ShareState {
  const state = publicLinkState(share, now);
  if (state !== 'live') return state;
  const refusal = shareGrantRefusal({
    userId: share.createdByUserId,
    role: share.creatorRole,
    mode: share.mode,
    isFolderLink: share.fileId === null,
    folderPath: share.folderPath,
    folderCreatorUserId: share.folderCreatorUserId,
  });
  return refusal === null ? 'live' : 'revoked';
}

export async function loadLiveShare(token: string) {
  const row = await loadShare(token);
  return row && shareLinkState(row, new Date()) === 'live' ? row : null;
}

/**
 * The files a link exposes: its one file, or the direct files of its folder, as
 * the link's creator can see them now. The share page and the bytes both read this.
 */
export function shareFileScope(share: {
  workspaceId: string;
  fileId: string | null;
  folderPath: string;
  createdByUserId: string;
}): SQL {
  const target =
    share.fileId !== null ? eq(file.id, share.fileId) : eq(file.folderPath, share.folderPath);
  return sql`(${eq(file.workspaceId, share.workspaceId)} and ${file.deletedAt} is null and ${target} and ${fileVisibleTo(share.createdByUserId)})`;
}
