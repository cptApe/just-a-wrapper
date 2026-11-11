import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace, workspaceMember } from '@/db/schema';
import { resolveCaller } from '@/lib/caller';
import type { WorkspaceRole } from '@/lib/workspace-role';

export type MemoryContext = {
  organizationId: string;
  userId: string;
  role: WorkspaceRole;
  userStoreId: string | null;
  workspaceStoreId: string | null;
};

// A removed member loses both stores even if the session still names this organization.
export async function resolveMemoryContext(headers: Headers): Promise<MemoryContext> {
  const { organizationId, userId, role } = await resolveCaller(headers);

  const ws = (
    await db
      .select({ storeId: workspace.workspaceMemoryStoreId })
      .from(workspace)
      .where(eq(workspace.organizationId, organizationId))
      .limit(1)
  ).at(0);

  const wm = (
    await db
      .select({ storeId: workspaceMember.userMemoryStoreId })
      .from(workspaceMember)
      .where(
        and(eq(workspaceMember.organizationId, organizationId), eq(workspaceMember.userId, userId)),
      )
      .limit(1)
  ).at(0);

  return {
    organizationId,
    userId,
    role,
    userStoreId: wm?.storeId ?? null,
    workspaceStoreId: ws?.storeId ?? null,
  };
}
