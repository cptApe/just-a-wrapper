import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { organization, workspace, workspaceNotDeleted } from '@/db/schema';
import { AppError } from '@/lib/errors';

// The one workspace-rename path, behind the /settings/workspace form. Callers resolve and authorize the
// workspace id at their own boundary; this just performs the scoped write.
//
// It renames BOTH rows: `workspace.name` (what the shell renders) and Better
// Auth's `organization.name` (what invitation emails and the /invite accept
// page show, via getInvitation). The org name is user-visible, so the two
// must move together. Same transaction so they can't drift on a partial failure.
export async function renameWorkspace(input: {
  workspaceId: string;
  name: string;
}): Promise<{ id: string; name: string }> {
  return db.transaction(async (tx) => {
    const row = (
      await tx
        .update(workspace)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(workspace.id, input.workspaceId), workspaceNotDeleted))
        .returning({
          id: workspace.id,
          name: workspace.name,
          organizationId: workspace.organizationId,
        })
    ).at(0);
    if (!row) {
      throw new AppError('WORKSPACE_NOT_FOUND', 'workspace not found', {
        workspaceId: input.workspaceId,
      });
    }
    await tx
      .update(organization)
      .set({ name: input.name })
      .where(eq(organization.id, row.organizationId));
    return { id: row.id, name: row.name };
  });
}
