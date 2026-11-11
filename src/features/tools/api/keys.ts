export const toolQueryKeys = {
  // Same key as when the replay player lived in chat, so cached entries keep their identity.
  replay: (sessionId: string, browserId: string) =>
    ['chat', sessionId, 'replay', browserId] as const,
};
