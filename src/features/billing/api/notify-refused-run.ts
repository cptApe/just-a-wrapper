import 'server-only';
import { notify } from '@/features/notifications/api/notify';
import { captureException } from '@/lib/observability';
import { creditPauseNotice } from '../lib/credit-pause-notice';

/** Tells the workspace that an unattended run did not start, with the paused-session notice. */
export async function notifyRefusedRun(input: {
  organizationId: string;
  taskId: string;
  reason: 'credits' | 'member_limit';
  /** Keys notification retries, so one refusal sends one notice. */
  refusalKey: string;
}): Promise<void> {
  await notify('credits.paused', {
    organizationId: input.organizationId,
    idempotencyKey: `${input.reason}-refused:${input.refusalKey}`,
    data: { taskId: input.taskId, ...creditPauseNotice(input.reason) },
  }).catch((error: unknown) =>
    captureException(error, { feature: 'billing', op: 'refused-run-notify', taskId: input.taskId }),
  );
}
