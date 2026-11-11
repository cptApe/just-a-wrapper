import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable, workspace } from '@/db/schema';
import { workspaceCreditBalance } from '@/features/billing/lib/workspace-credit-balance';
import { shipLog } from '@/lib/logger';
import { capabilities } from '@/lib/runtime-capabilities';

import 'server-only';
import { type BillableTier } from '../lib/credit-math';
import type { WorkspacePlan } from '../pricing-config';
import { type AccrualResult, NOT_BILLED } from './accrual-result';

export type BillableSession = {
  rowId: string;
  platformPaid: boolean;
  anthropicSessionId: string;
  workspaceId: string;
  organizationId: string;
  tier: BillableTier;
  visibility: 'private' | 'workspace';
  createdByUserId: string;
  creditBalance: number;
  creditResetAt: Date | null;
  planTier: WorkspacePlan;
};

// Keep session visibility and creator identity so pause events cannot leak private sessions.
// A concurrent plan change is read by the next accrual.
export async function loadBillableSession(
  anthropicSessionId: string,
): Promise<BillableSession | null> {
  const row = (
    await db
      .select({
        rowId: sessionTable.id,
        workspaceId: sessionTable.workspaceId,
        organizationId: workspace.organizationId,
        tier: sessionTable.tier,
        visibility: sessionTable.visibility,
        createdByUserId: sessionTable.createdByUserId,
        creditBalance: workspaceCreditBalance,
        creditResetAt: workspace.creditResetAt,
        planTier: workspace.planTier,
      })
      .from(sessionTable)
      .innerJoin(workspace, eq(sessionTable.workspaceId, workspace.id))
      .where(eq(sessionTable.anthropicSessionId, anthropicSessionId))
      .limit(1)
  ).at(0);
  if (!row) return null;
  // With billing off the operator pays, so usage is recorded without touching a credit ledger.
  return { ...row, platformPaid: capabilities.billing.kind === 'off', anthropicSessionId };
}

// Console-created sessions are not billed here; rejecting their webhooks forever can disable provider delivery.
export function skipUnknownSession(kind: string, anthropicSessionId: string): AccrualResult {
  shipLog({
    level: 'warn',
    msg: 'billing.accrual_skipped_unknown_session',
    feature: 'billing',
    op: `accrue-${kind}`,
    session_id: anthropicSessionId,
  });
  return NOT_BILLED;
}
