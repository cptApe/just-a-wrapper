import { IconCreditCard01, IconZap } from '@/components/icons';
import { openOverlay } from '@/features/overlays/lib/overlay-history';
import type { SendFailure } from './classify-send-failure';
import {
  CREDITS_EXHAUSTED_BANNER_ID,
  dismissComposerBanner,
  registerComposerBanner,
} from './composer-banner-store';

// Its own id, so a repeat replaces it instead of fighting the credits banner for the slot.
const PLAN_LIMIT_BANNER_ID = 'plan-limit-reached';

/**
 * Home and a task show a refused send the same way: the server's sentence above the composer.
 * Out of credits offers the top-up dialog; a member's own limit has no action, because credits do
 * not lift it. A plan limit offers the plan dialog where plans are sold, and nothing elsewhere.
 * Returns whether a banner explains the failure.
 */
export function showSendFailureBanner(
  failure: SendFailure,
  { plansForSale }: { plansForSale: boolean },
): boolean {
  switch (failure.kind) {
    case 'credits-exhausted':
      registerComposerBanner({
        id: CREDITS_EXHAUSTED_BANNER_ID,
        kind: 'billing',
        icon: IconCreditCard01,
        message: failure.message,
        action: { label: 'Add credits', onSelect: () => openOverlay('topup') },
      });
      return true;
    case 'member-limit':
      // Same slot as the credits banner: both say why this person cannot spend.
      registerComposerBanner({
        id: CREDITS_EXHAUSTED_BANNER_ID,
        kind: 'billing',
        icon: IconCreditCard01,
        message: failure.message,
      });
      return true;
    case 'plan-limit':
      registerComposerBanner({
        id: PLAN_LIMIT_BANNER_ID,
        kind: 'billing',
        icon: IconZap,
        message: failure.message,
        ...(plansForSale
          ? { action: { label: 'See plans', onSelect: () => openOverlay('plans') } }
          : {}),
      });
      return true;
    default:
      return false;
  }
}

/** A send went through, so neither refusal holds any more. */
export function dismissSendFailureBanners(): void {
  dismissComposerBanner(CREDITS_EXHAUSTED_BANNER_ID);
  dismissComposerBanner(PLAN_LIMIT_BANNER_ID);
}
