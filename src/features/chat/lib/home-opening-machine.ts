import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';

export type HomeOpeningState =
  | { kind: 'idle' }
  | {
      kind: 'creating';
      attempt: symbol;
      text: string;
      attachments: OptimisticComposerAttachment[];
      sessionId: string | null;
    }
  | { kind: 'opened'; sessionId: string }
  | { kind: 'failed'; message: string | null };

type HomeOpeningEvent =
  | { type: 'start'; attempt: symbol; text: string; attachments: OptimisticComposerAttachment[] }
  | { type: 'created'; attempt: symbol; sessionId: string }
  | { type: 'prepared'; attempt: symbol; text: string }
  | { type: 'delivered'; attempt: symbol; sessionId: string }
  | { type: 'failed'; attempt: symbol; message: string | null }
  | { type: 'reset' };

export function reduceHomeOpening(
  state: HomeOpeningState,
  event: HomeOpeningEvent,
): HomeOpeningState {
  if (event.type === 'reset') return { kind: 'idle' };
  if (event.type === 'start') {
    return state.kind === 'creating'
      ? state
      : {
          kind: 'creating',
          attempt: event.attempt,
          text: event.text,
          attachments: event.attachments,
          sessionId: null,
        };
  }
  if (state.kind !== 'creating' || state.attempt !== event.attempt) return state;
  switch (event.type) {
    case 'created':
      return { ...state, sessionId: event.sessionId };
    case 'prepared':
      return { ...state, text: event.text };
    case 'delivered':
      return { kind: 'opened', sessionId: event.sessionId };
    case 'failed':
      return { kind: 'failed', message: event.message };
  }
}
