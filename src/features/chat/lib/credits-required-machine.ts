import type { ComposerCreditsState } from '../types';

// `auto` lets the modal open by itself until dismissed; `asked` is a send that needs
// credits, so it shows even after a dismissal.
export type CreditsRequiredState = { kind: 'auto' } | { kind: 'asked' };

type CreditsRequiredEvent = { type: 'send' | 'close' };

export function reduceCreditsRequired(
  _state: CreditsRequiredState,
  event: CreditsRequiredEvent,
): CreditsRequiredState {
  switch (event.type) {
    case 'send':
      return { kind: 'asked' };
    case 'close':
      return { kind: 'auto' };
  }
}

/** Only a confirmed empty balance with no plan counts: a load or read failure never does. */
export function isCreditsRequired(credits: ComposerCreditsState): boolean {
  return credits.kind === 'ready' && credits.creditBalance <= 0 && !credits.hasPlan;
}

export function isCreditsRequiredOpen(
  state: CreditsRequiredState,
  { required, dismissed }: { required: boolean; dismissed: boolean },
): boolean {
  if (!required) return false;
  if (state.kind === 'asked') return true;
  return !dismissed;
}
