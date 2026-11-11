'use client';

import { IconCreditCard01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { WarningBar } from '@/components/ui/warning-bar';
import { openOverlay } from '@/features/overlays/lib/overlay-history';
import { useActiveComposerBanner } from '../hooks/use-composer-banner';
import { CREDITS_EXHAUSTED_BANNER_ID } from '../lib/composer-banner-store';
import type { ComposerCreditsState } from '../types';

export function ComposerCreditsNotice({
  state,
  retry,
}: {
  state: ComposerCreditsState;
  retry: () => void;
}) {
  // A refused send already shows the same news in the banner slot, with the server's sentence.
  const refusedSend = useActiveComposerBanner()?.id === CREDITS_EXHAUSTED_BANNER_ID;
  // Quiet while the balance loads: Send stays disabled, but a warning bar
  // flashing on every task open would read as a problem when there is none.
  if (refusedSend || state.kind === 'loading' || state.kind === 'off') return null;
  if (state.kind === 'ready' && state.creditBalance > 0) return null;
  return (
    <WarningBar
      role="status"
      className="mb-2"
      data-testid="composer-credits-notice"
      icon={IconCreditCard01}
      message={
        state.kind === 'error'
          ? 'Couldn’t check your credits. Try again before sending.'
          : 'You’re out of credits. Add credits to keep going.'
      }
      action={
        state.kind === 'error' ? (
          <Button type="button" size="sm" onClick={retry}>
            Try again
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => openOverlay('topup')}>
            Add credits
          </Button>
        )
      }
    />
  );
}
