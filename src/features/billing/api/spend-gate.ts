import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace } from '@/db/schema';
import { CREDITS_EXHAUSTED_MESSAGE, MEMBER_LIMIT_MESSAGE } from '@/lib/credits-copy';
import { BillingError } from '@/lib/errors';
import { formatCount } from '@/lib/format/format-number';
import { capabilities } from '@/lib/runtime-capabilities';
import type { GatedEntryPoint } from '../lib/paid-entry-points';
import { MIN_TURN_CREDITS } from '../pricing-config';
import { type BillingTx, deriveWorkspaceCreditBalance } from './credit-ledger';
import { loadMemberCreditUsage } from './member-credit-usage';

// The one answer to "may this person spend this estimate in this workspace now?" It reads the
// balance and the member's allowance on the database clock and reserves nothing (decision 0037).

export type SpendRequest = {
  entry: GatedEntryPoint;
  workspaceId: string;
  /** The person the spend counts against for their member credit limit. */
  userId: string;
  /** Estimated credits of the paid work; zero for a model turn, whose cost is unknown upfront. */
  credits?: number;
};

export type SpendRefusal = { reason: 'credits' | 'member_limit'; error: BillingError };

/** What the workspace and the member can still spend. `memberRemaining` is null without a limit. */
export type SpendAllowance = { balance: number; memberRemaining: number | null };

/** The credits a session may spend before the provider stops it. */
export function spendableCredits(allowance: SpendAllowance): number {
  if (allowance.memberRemaining === null) return allowance.balance;
  return Math.min(allowance.balance, allowance.memberRemaining);
}

/** Reads both on the database clock; a null user reads the workspace balance alone. */
export async function readSpendAllowance(
  tx: BillingTx,
  input: { workspaceId: string; userId: string | null },
): Promise<SpendAllowance> {
  const row = (
    await tx
      .select({
        planTier: workspace.planTier,
        creditResetAt: workspace.creditResetAt,
        organizationId: workspace.organizationId,
      })
      .from(workspace)
      .where(eq(workspace.id, input.workspaceId))
  ).at(0);
  if (!row) {
    throw new BillingError('WORKSPACE_NOT_FOUND', 'no workspace for the spend gate', {
      workspaceId: input.workspaceId,
    });
  }
  const balance = await deriveWorkspaceCreditBalance(tx, input.workspaceId);
  if (input.userId === null) return { balance, memberRemaining: null };
  const usage = await loadMemberCreditUsage(
    tx,
    { ...row, workspaceId: input.workspaceId, userId: input.userId },
    { forUpdate: false },
  );
  return {
    balance,
    memberRemaining: usage.creditLimit === null ? null : usage.creditLimit - usage.used,
  };
}

/** Returns why the spend is refused, or null when it may go ahead. Unattended runs record the reason. */
export async function checkSpend(
  request: SpendRequest,
  executor?: BillingTx,
): Promise<SpendRefusal | null> {
  if (capabilities.billing.kind === 'off') return null;
  const credits = request.credits ?? 0;
  if (!Number.isFinite(credits) || credits < 0) {
    throw new BillingError('VALIDATION_FAILED', 'Invalid credit estimate', {
      entry: request.entry,
      workspaceId: request.workspaceId,
      credits,
    });
  }
  const allowance = executor
    ? await readSpendAllowance(executor, request)
    : await db.transaction((tx) => readSpendAllowance(tx, request));
  // Estimates can round to zero, so paid work always needs at least one credit on hand.
  const required = Math.max(credits, MIN_TURN_CREDITS);
  if (allowance.memberRemaining !== null && allowance.memberRemaining < required)
    return spendRefusal('member_limit', request, required, allowance.memberRemaining);
  if (allowance.balance < required)
    return spendRefusal('credits', request, required, allowance.balance);
  return null;
}

// Both refusals are states the person can act on, so they carry authored copy and are never
// reported as incidents. Action-result toasts (files and memory panes) show the message as written.
function spendRefusal(
  reason: SpendRefusal['reason'],
  request: SpendRequest,
  required: number,
  available: number,
): SpendRefusal {
  const left = formatCount(Math.max(0, available));
  const needs = `This tool needs ${formatCount(request.credits ?? 0)} credits`;
  const turn = required === MIN_TURN_CREDITS;
  const message =
    reason === 'credits'
      ? turn
        ? CREDITS_EXHAUSTED_MESSAGE
        : `${needs}, but you have ${left}; add credits to continue.`
      : turn
        ? MEMBER_LIMIT_MESSAGE
        : `${needs}, but your credit limit leaves ${left}; ask a workspace admin to raise it.`;
  return {
    reason,
    error: new BillingError('CREDITS_EXHAUSTED', message, {
      entry: request.entry,
      workspaceId: request.workspaceId,
      userId: request.userId,
      reason,
      available,
      requiredCredits: required,
      expectedState: true,
    }),
  };
}

/** Throws the refusal for a person who is present to read it. */
export async function assertCanSpend(request: SpendRequest): Promise<void> {
  const refusal = await checkSpend(request);
  if (refusal) throw refusal.error;
}
