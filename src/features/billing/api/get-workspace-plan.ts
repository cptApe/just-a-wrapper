import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace, workspaceNotDeleted } from '@/db/schema';
import 'server-only';
import type { WorkspacePlan } from '../pricing-config';

// Plan gates use stored entitlement instead of Stripe round trips; deleted workspaces resolve for nobody.
export async function getWorkspacePlanTier(workspaceId: string): Promise<WorkspacePlan | null> {
  const workspaceRow = (
    await db
      .select({ planTier: workspace.planTier })
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), workspaceNotDeleted))
      .limit(1)
  ).at(0);
  return workspaceRow?.planTier ?? null;
}
