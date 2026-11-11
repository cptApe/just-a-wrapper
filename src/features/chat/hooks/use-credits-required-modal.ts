'use client';

import { useReducer, useSyncExternalStore } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import {
  dismissCreditsRequired,
  isCreditsRequiredDismissed,
  subscribeCreditsRequiredDismissal,
} from '../lib/credits-required-dismissal';
import {
  type CreditsRequiredState,
  isCreditsRequiredOpen,
  reduceCreditsRequired,
} from '../lib/credits-required-machine';

const INITIAL_STATE: CreditsRequiredState = { kind: 'auto' };

export function useCreditsRequiredModal(required: boolean) {
  const organizationId = useOrganizationId();
  const [state, dispatch] = useReducer(reduceCreditsRequired, INITIAL_STATE);
  // The server snapshot counts as dismissed so the modal never renders before hydration.
  const dismissed = useSyncExternalStore(
    subscribeCreditsRequiredDismissal,
    () => organizationId === null || isCreditsRequiredDismissed(organizationId),
    () => true,
  );
  function dismiss() {
    if (organizationId !== null) dismissCreditsRequired(organizationId);
  }
  function close() {
    dismiss();
    dispatch({ type: 'close' });
  }
  return {
    open: isCreditsRequiredOpen(state, { required, dismissed }),
    requestFromSend: () => dispatch({ type: 'send' }),
    close,
  };
}
