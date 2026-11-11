import type { ChatEvent, ChatPreviewType } from '@/features/sessions';
import { applyPreviewDelta, applyPreviewStart } from './chat-preview';
import type { ChatState } from './chat-state';
import { reduceEvent } from './chat-store';

type ReducerAction =
  | { type: 'event'; event: ChatEvent }
  | { type: 'preview_start'; eventId: string; previewType: ChatPreviewType }
  | { type: 'preview_delta'; eventId: string; index: number; text: string };

export function chatReducer(state: ChatState, action: ReducerAction): ChatState {
  switch (action.type) {
    case 'event':
      return reduceEvent(state, action.event);
    case 'preview_start':
      return applyPreviewStart(state, action);
    case 'preview_delta':
      return applyPreviewDelta(state, action);
  }
}
