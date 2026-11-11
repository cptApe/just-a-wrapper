// The durable settlement row retries delivery failures without charging the ledger again.

import { notify } from '@/features/notifications/api/notify';
import { LOW_CREDITS_THRESHOLD } from '@/features/notifications/lib/events';
import { publishWorkspaceEvent } from '@/features/realtime/api/publish';
import { captureEvent } from '@/lib/analytics';
import { shipLog } from '@/lib/logger';
import { captureException } from '@/lib/observability';
import 'server-only';
import { type AccrualResult } from './accrual-result';
import { type AccrualCost, type ChargeResult } from './apply-credit-charge';
import { type BillableSession } from './load-billable-session';
import { maybeAutoTopup } from './maybe-auto-topup';
import { pauseSessionOnExhaustion } from './pause-session-on-exhaustion';
import { type WorkspacePayer } from './record-workspace-usage';

// Usage with no session (dictation) settles against its workspace and never pauses a session.
export type SettlementTarget = BillableSession | WorkspacePayer;

// Bind identity explicitly because accrual also runs outside HTTP requests. Telemetry failure cannot undo committed usage.
async function emitPlatformCost(target: SettlementTarget, cost: AccrualCost): Promise<void> {
  const userId = 'rowId' in target ? target.createdByUserId : target.userId;
  const properties = {
    platform_paid: true,
    vendor_cost_cents: cost.vendorCostCents,
    usage_kind: cost.eventType,
    accrual_event_id: cost.eventId,
    session_id: 'rowId' in target ? target.anthropicSessionId : null,
    workspace_id: target.workspaceId,
    organization_id: target.organizationId,
    user_id: userId,
    credits: 0,
  };
  const emissions = await Promise.allSettled([
    Promise.resolve().then(() =>
      shipLog(
        { msg: 'billing.platform_cost', feature: 'billing', ...properties },
        { inheritRequestContext: false },
      ),
    ),
    Promise.resolve().then(() =>
      captureEvent('billing:credit_spend', properties, {
        userId,
        workspaceId: target.workspaceId,
      }),
    ),
  ]);
  await Promise.allSettled(
    emissions.flatMap((result) =>
      result.status === 'rejected'
        ? [
            Promise.resolve().then(() =>
              captureException(result.reason, {
                feature: 'billing',
                op: 'platform-cost-telemetry',
                ...properties,
              }),
            ),
          ]
        : [],
    ),
  );
}

export async function settleAccrual(
  target: SettlementTarget,
  credits: number,
  charge: ChargeResult,
): Promise<AccrualResult> {
  const { balance, memberLimitExceeded: limitExceeded } = charge;
  if (charge.platformCost) {
    await emitPlatformCost(target, charge.platformCost);
    return { billed: true, credits: 0, balance, paused: false };
  }
  const pauseReason = limitExceeded ? 'member_limit' : balance <= 0 ? 'credits' : null;
  const paused =
    pauseReason && 'rowId' in target
      ? await pauseSessionOnExhaustion(target, balance, { reason: pauseReason })
      : false;
  if (!paused) {
    await publishCredits(target.organizationId, balance);
    // Warn only on a downward threshold crossing. A stable workspace key would suppress later dips after top-ups.
    const prev = balance + credits;
    if (balance > 0 && balance < LOW_CREDITS_THRESHOLD && prev >= LOW_CREDITS_THRESHOLD) {
      await notify('credits.low', {
        organizationId: target.organizationId,
        idempotencyKey: `low-credits:${charge.eventId}`,
        data: { balance, title: 'Credits running low' },
      });
    }
  }
  // Reports its own failures and never throws, so Stripe cannot stop settlement.
  await maybeAutoTopup(target.workspaceId);
  return { billed: true, credits, balance, paused };
}

async function publishCredits(organizationId: string, balance: number): Promise<void> {
  await publishWorkspaceEvent(organizationId, { type: 'credits', balance });
}
