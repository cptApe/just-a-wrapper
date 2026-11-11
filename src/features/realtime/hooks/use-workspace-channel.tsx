'use client';
import { useEffect, useRef } from 'react';
import type { PublishedWorkspaceEvent } from '../lib/channel';
import { retainStream } from '../lib/stream-store';

export function useWorkspaceChannel(
  organizationId: string | null,
  userId: string | null,
  onEvent: (event: PublishedWorkspaceEvent) => void,
) {
  // Changing a consumer callback must not reconnect the shared stream or lose its resume cursor.
  const callback = useRef(onEvent);
  useEffect(() => {
    callback.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    if (!organizationId || !userId) return;
    return retainStream(organizationId, userId, (event) => callback.current(event));
  }, [organizationId, userId]);
}
