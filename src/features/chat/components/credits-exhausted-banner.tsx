'use client';

import { IconCreditCard01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { WarningBar } from '@/components/ui/warning-bar';
import { openOverlay } from '@/features/overlays/lib/overlay-history';
import type { SessionPauseReason } from '@/features/sessions';
import { CREDITS_EXHAUSTED_MESSAGE } from '@/lib/credits-copy';

// Show credit exhaustion above the composer while paused_no_credits is active.
// Top-up auto-resumes recent pauses; older pauses need explicit Resume.
// Report 402 when still empty and clear the banner through realtime status.
export function CreditsExhaustedBanner({
  reason,
  onResume,
  resuming,
}: {
  reason: SessionPauseReason | null;
  onResume: () => void | Promise<void>;
  resuming: boolean;
}) {
  const memberLimited = reason === 'member_limit';
  const budgetLimited = reason === 'budget';
  return (
    <WarningBar
      role="alert"
      data-testid="credits-exhausted-banner"
      className="mx-auto mb-2 w-full max-w-3xl"
      icon={IconCreditCard01}
      message={
        memberLimited
          ? 'This task is paused. Ask a workspace admin to raise your credit limit.'
          : budgetLimited
            ? 'This task hit its spending cap. Resume to raise it.'
            : CREDITS_EXHAUSTED_MESSAGE
      }
      action={
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={resuming}
            onClick={() => void onResume()}
            data-testid="resume-task"
          >
            {resuming ? 'Resuming…' : 'Resume'}
          </Button>
          {!memberLimited && (
            <Button type="button" size="sm" onClick={() => openOverlay('topup')}>
              Add credits
            </Button>
          )}
        </>
      }
    />
  );
}
