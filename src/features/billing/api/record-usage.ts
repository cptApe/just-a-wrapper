// The usage row, the session totals and the credit debit share one transaction, so a replayed
// event hits the usage key's unique index and cannot charge twice.

import { eq, sql } from 'drizzle-orm';
import { session } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import 'server-only';
import {
  creditsDueForSessionTotal,
  creditsForVendorCents,
  type ModelTokenUsage,
} from '../lib/credit-math';
import { roundVendorCents } from '../lib/round-vendor-cents';
import type { BillingTx } from './credit-ledger';
import { recordUsageSettlement } from './usage-settlement-transitions';

export type UsageCost = { vendorCostCents: number; eventId: string } & (
  | { eventType: 'model_request' | 'title_generation'; usage: ModelTokenUsage }
  | { eventType: 'container_runtime'; seconds: number }
  | { eventType: 'tool_call' | 'generation' | 'voice_tts' }
  | { eventType: 'voice_transcription'; audioSeconds: number }
);

export type UsagePayer = {
  workspaceId: string;
  // The member the usage counts against in member limits and the usage log.
  userId: string;
  platformPaid: boolean;
  sessionRowId: string | null;
};

export type RecordedUsage = { credits: number };

export type SessionTotals = {
  vendorCostCents: number;
  creditsConsumed: number;
  containerSeconds: number;
};

// NO KEY UPDATE serializes accruals on one session without conflicting with usage-event foreign-key locks.
export async function lockSessionTotals(
  tx: BillingTx,
  rowId: string,
): Promise<SessionTotals | undefined> {
  return (
    await tx
      .select({
        vendorCostCents: session.vendorCostCents,
        creditsConsumed: session.creditsConsumed,
        containerSeconds: session.containerSeconds,
      })
      .from(session)
      .where(eq(session.id, rowId))
      .for('no key update')
  ).at(0);
}

// Returns null when the usage key was already recorded.
export async function recordUsage(
  tx: BillingTx,
  payer: UsagePayer,
  cost: UsageCost,
): Promise<RecordedUsage | null> {
  const vendorCostCents = roundVendorCents(cost.vendorCostCents);
  const totals = payer.sessionRowId ? await lockSessionTotals(tx, payer.sessionRowId) : null;
  if (payer.sessionRowId && !totals)
    throw new BillingError('SESSION_NOT_FOUND', 'cannot record usage for a missing session', {
      sessionId: payer.sessionRowId,
      eventId: cost.eventId,
    });
  const credits = payer.platformPaid
    ? 0
    : totals
      ? creditsDueForSessionTotal(totals.vendorCostCents + vendorCostCents, totals.creditsConsumed)
      : creditsForVendorCents(vendorCostCents);

  const inserted = await recordUsageSettlement(tx, {
    workspaceId: payer.workspaceId,
    sessionId: payer.sessionRowId,
    userId: payer.userId,
    eventType: cost.eventType,
    usageKey: cost.eventId,
    creditsDelta: -credits,
    platformPaid: payer.platformPaid,
    vendorCostCents,
    ...usageColumns(cost),
  });
  if (inserted.length === 0) return null;

  if (payer.sessionRowId) {
    // Platform-paid cost stays out of the total so it is never charged if billing is turned on later.
    const billable = payer.platformPaid ? 0 : vendorCostCents;
    await tx
      .update(session)
      .set({
        vendorCostCents: sql`${session.vendorCostCents} + ${billable}`,
        creditsConsumed: sql`${session.creditsConsumed} + ${credits}`,
        ...(cost.eventType === 'container_runtime'
          ? { containerSeconds: sql`${session.containerSeconds} + ${cost.seconds}` }
          : {}),
      })
      .where(eq(session.id, payer.sessionRowId));
  }
  return { credits };
}

function usageColumns(cost: UsageCost) {
  switch (cost.eventType) {
    case 'model_request':
    case 'title_generation':
      return {
        tokensIn: cost.usage.inputTokens,
        tokensOut: cost.usage.outputTokens,
        cacheCreationTokens: cost.usage.cacheCreationTokens,
        cacheReadTokens: cost.usage.cacheReadTokens,
      };
    case 'container_runtime':
      return { containerSeconds: cost.seconds };
    case 'voice_transcription':
      return { audioSeconds: Math.ceil(cost.audioSeconds) };
    default:
      return {};
  }
}
