import type { MessageChatItem } from './chat-state';
export type MessageDelivery =
  | { kind: 'anchor'; message: MessageChatItem }
  | { kind: 'queued'; message: MessageChatItem }
  | { kind: 'processed'; message: MessageChatItem };
export function messageDelivery(message: MessageChatItem): MessageDelivery {
  return {
    kind:
      message.localId === message.id ? 'anchor' : message.at === undefined ? 'queued' : 'processed',
    message,
  };
}
export function messageDeliveryReducer(
  state: MessageDelivery,
  echo: { id: string; at?: string },
): MessageDelivery {
  if (state.kind === 'processed') return state;
  if (state.kind === 'queued' && state.message.id !== echo.id) return state;
  const message = { ...state.message, id: echo.id, at: echo.at };
  return { kind: echo.at === undefined ? 'queued' : 'processed', message };
}
