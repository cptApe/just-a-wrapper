import 'server-only';
import type { BetaManagedAgentsBudgetLimit } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import { db } from '@/db';
import { capabilities } from '@/lib/runtime-capabilities';
import { sessionBudgetForCreditBalance } from '../lib/session-budget-value';
import { readSpendAllowance, spendableCredits } from './spend-gate';

/**
 * The budget for a new session or deployment template. An unattended run names its creator, so
 * the provider stops it at the creator's remaining member allowance between spend checks. A chat
 * has a person present and a template serves runs at unknown times, so both cap at the balance.
 * Billing off has no credit pool to cap against.
 */
export async function sessionBudgetForWorkspace(
  workspaceId: string,
  unattendedCreatorId: string | null = null,
): Promise<BetaManagedAgentsBudgetLimit | undefined> {
  if (capabilities.billing.kind === 'off') return undefined;
  const allowance = await db.transaction((tx) =>
    readSpendAllowance(tx, { workspaceId, userId: unattendedCreatorId }),
  );
  return sessionBudgetForCreditBalance(spendableCredits(allowance), 0);
}
