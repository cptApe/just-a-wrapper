import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace, workspaceNotDeleted } from '@/db/schema';

// The workspace display name for an org, by `organization_id` (indexed, unique).
// Backs the `(app)` shell header once the org is known. Returns null when no workspace row
// exists yet (a partial/in-flight provision); callers apply their own fallback.
export async function getWorkspaceName(organizationId: string): Promise<string | null> {
  const ws = (
    await db
      .select({ name: workspace.name })
      .from(workspace)
      // A soft-deleted workspace has no name to show — the shell header falls back
      // like any partial provision.
      .where(and(eq(workspace.organizationId, organizationId), workspaceNotDeleted))
      .limit(1)
  ).at(0);
  return ws?.name ?? null;
}
