'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  type BackgroundSessionStream,
  openBackgroundSessionStream,
} from '../lib/open-background-session-stream';

/** Keep running chats observed after navigation closes their chat view. Uses
 * the existing authenticated relay, not polling, and releases each connection
 * on completion, navigation back to the chat, workspace switch or logout. */
export function useBackgroundSessionStreams(sessionIds: string[], workspaceId: string): void {
  const queryClient = useQueryClient();
  const sources = useRef(new Map<string, BackgroundSessionStream>());
  const idsKey = sessionIds
    .filter((id) => !id.startsWith('pending-'))
    .sort()
    .join(',');

  useEffect(() => {
    const current = sources.current;
    return () => {
      for (const source of current.values()) source.close();
      current.clear();
    };
  }, [workspaceId]);

  useEffect(() => {
    const desired = new Set(idsKey ? idsKey.split(',') : []);
    for (const [id, source] of sources.current) {
      if (!desired.has(id)) {
        source.close();
        sources.current.delete(id);
      }
    }
    for (const id of desired) {
      if (sources.current.has(id)) continue;
      const source = openBackgroundSessionStream(queryClient, id);
      sources.current.set(id, source);
    }
  }, [idsKey, queryClient, workspaceId]);
}
