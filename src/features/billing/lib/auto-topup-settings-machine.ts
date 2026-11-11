import type { AutoTopupSettings } from '../api/auto-topup-settings';

type Draft = { enabled: boolean; threshold: number; credits: number; capDollars: number };
export type AutoTopupSettingsState = { saved: AutoTopupSettings; draft: Draft } & (
  | { kind: 'editing'; error: string | null }
  | { kind: 'saving'; attempt: string }
);
export type AutoTopupSettingsEvent =
  | { type: 'edit'; draft: Partial<Draft> }
  | { type: 'validate'; error: string | null }
  | { type: 'start'; attempt: string }
  | { type: 'saved'; attempt: string; saved: AutoTopupSettings }
  | { type: 'failed'; attempt: string };
export function autoTopupSettingsInitial(saved: AutoTopupSettings): AutoTopupSettingsState {
  return {
    kind: 'editing',
    error: null,
    saved,
    draft: {
      enabled: saved.enabled,
      threshold: saved.thresholdCredits,
      credits: saved.topupCredits,
      capDollars: saved.monthlyCapCents / 100,
    },
  };
}
export function autoTopupSettingsReducer(
  state: AutoTopupSettingsState,
  event: AutoTopupSettingsEvent,
): AutoTopupSettingsState {
  if (event.type === 'edit')
    return state.kind === 'editing'
      ? { ...state, draft: { ...state.draft, ...event.draft } }
      : state;
  if (event.type === 'validate')
    return state.kind === 'editing' ? { ...state, error: event.error } : state;
  if (event.type === 'start')
    return state.kind === 'editing'
      ? { kind: 'saving', saved: state.saved, draft: state.draft, attempt: event.attempt }
      : state;
  if (state.kind !== 'saving' || state.attempt !== event.attempt) return state;
  return event.type === 'saved'
    ? autoTopupSettingsInitial(event.saved)
    : { kind: 'editing', error: null, saved: state.saved, draft: state.draft };
}
