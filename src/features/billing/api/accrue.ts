import 'server-only';
import { captureException } from '@/lib/observability';
import { type AccrualResult } from './accrual-result';
import { retryTransientAccrual } from './accrue-retry';
import type { ChargeResult } from './apply-credit-charge';
import {
  type BillableSession,
  loadBillableSession,
  skipUnknownSession,
} from './load-billable-session';
import type { WorkspacePayer } from './record-workspace-usage';
import { finishOrRecoverAccrual } from './settle-recorded-accrual';

/** What a recorder committed: the credits and charge, or null when the usage key was already recorded. */
type RecordedAccrual = { credits: number; charge: ChargeResult | null } | null;

/** Usage on a session. `kind` names the usage in the log line for an unknown session. */
type SessionAccrualTarget = {
  anthropicSessionId: string;
  kind: string;
  /** The platform pays (naming a chat), whatever the billing mode. */
  platformPaid?: true;
};

type Recorder<T> = (target: T) => Promise<RecordedAccrual>;

/**
 * The one way usage becomes a charge. It owns three rules every entry point shares:
 * - a transient database failure retries the whole accrual; the usage key makes a retry a replay;
 * - usage on a session this app does not know is logged and skipped, never thrown: nobody can be
 *   charged for it, and the provider stops delivering webhooks that keep failing;
 * - once the charge is recorded, a failed settlement (broadcast, pause, top-up) is reported and the
 *   result still says billed: the pending-settlement sweep finishes it, and the person keeps what
 *   they paid for.
 */
export function accrue(
  target: SessionAccrualTarget,
  usageKey: string,
  record: Recorder<BillableSession>,
): Promise<AccrualResult>;
export function accrue(
  target: WorkspacePayer,
  usageKey: string,
  record: Recorder<WorkspacePayer>,
): Promise<AccrualResult>;
export async function accrue(
  target: SessionAccrualTarget | WorkspacePayer,
  usageKey: string,
  record: Recorder<BillableSession> | Recorder<WorkspacePayer>,
): Promise<AccrualResult> {
  const charged: { recorded: boolean; applied: RecordedAccrual } = {
    recorded: false,
    applied: null,
  };
  const settle = async <T extends BillableSession | WorkspacePayer>(
    payer: T,
    recordFor: Recorder<T>,
  ) => {
    const applied = await recordFor(payer);
    // A replay after a committed first attempt keeps the first attempt's credits.
    if (!charged.applied) charged.applied = applied;
    charged.recorded = true;
    return finishOrRecoverAccrual(payer, usageKey, applied);
  };
  const attempt =
    'anthropicSessionId' in target
      ? async () => {
          const session = await loadBillableSession(target.anthropicSessionId);
          if (!session) return skipUnknownSession(target.kind, target.anthropicSessionId);
          const payer = target.platformPaid ? { ...session, platformPaid: true } : session;
          return settle(payer, record as Recorder<BillableSession>);
        }
      : () => settle(target, record as Recorder<WorkspacePayer>);
  const context =
    'anthropicSessionId' in target
      ? { usageKey, anthropicSessionId: target.anthropicSessionId }
      : { usageKey, workspaceId: target.workspaceId };
  try {
    return await retryTransientAccrual(attempt, context);
  } catch (error) {
    if (!charged.recorded) throw error;
    captureException(error, { feature: 'billing', op: 'accrual-settlement', usageKey });
    return {
      billed: true,
      credits: charged.applied?.credits ?? 0,
      balance: charged.applied?.charge?.balance ?? null,
      paused: false,
    };
  }
}
