import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace } from '@/db/schema';
import { workspaceCreditBalance } from '@/features/billing/lib/workspace-credit-balance';
import 'server-only';
import { memberCreditPeriodStart } from '../lib/credit-grants';

export type UsageContext = {
  workspaceId: string;
  createdAt: Date;
  creditResetAt: Date | null;
  creditBalance: number;
};

export async function getUsageContext(organizationId: string): Promise<UsageContext | null> {
  const workspaceRow = (
    await db
      .select({
        workspaceId: workspace.id,
        createdAt: workspace.createdAt,
        creditResetAt: workspace.creditResetAt,
        planTier: workspace.planTier,
        creditBalance: workspaceCreditBalance,
      })
      .from(workspace)
      .where(eq(workspace.organizationId, organizationId))
      .limit(1)
  ).at(0);
  if (!workspaceRow) return null;
  return {
    ...workspaceRow,
    creditResetAt: memberCreditPeriodStart({ ...workspaceRow, now: new Date() }),
  };
}
