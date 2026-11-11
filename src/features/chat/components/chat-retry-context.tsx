'use client';
import { createContext, useContext } from 'react';
export const ChatRetryContext = createContext<(() => Promise<void>) | null>(null);
export function useChatRetry() {
  return useContext(ChatRetryContext);
}
