import type { BetaManagedAgentsBudgetLimit } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import { CENTS_PER_CREDIT } from './credit-math';

const MINIMUM_WORKSPACE_BUDGET_CENTS = 1;

// Anthropic budgets are absolute. Add already-consumed cost to remaining credits when refreshing
// an existing session; new sessions have consumed nothing.
export function sessionBudgetForCreditBalance(
  creditBalance: number,
  consumedListCostCents: number,
): BetaManagedAgentsBudgetLimit {
  // Anthropic requires a positive cap. A drained scheduled run gets the one-cent minimum so it
  // pauses immediately instead of consuming unbillable credit.
  const remainingListCostCents = Math.max(
    MINIMUM_WORKSPACE_BUDGET_CENTS,
    Math.floor(creditBalance * CENTS_PER_CREDIT),
  );
  const maxListCostCents = Math.max(0, Math.floor(consumedListCostCents)) + remainingListCostCents;
  return {
    type: 'limit',
    max_list_cost: { amount: String(maxListCostCents), currency: 'USD' },
  };
}
