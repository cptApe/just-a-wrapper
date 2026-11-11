'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { captureException } from '@/lib/observability-client';
import { chatQueryKeys } from './keys';
import { loadChatContext } from './load-chat-context';

export function useChatContext(
  organizationId: string | undefined,
  sessionId: string,
  enabled: boolean,
) {
  const query = useQuery({
    queryKey: chatQueryKeys.context(organizationId ?? '', sessionId),
    queryFn: () => loadChatContext(sessionId),
    enabled,
  });
  useEffect(() => {
    if (!query.error) return;
    captureException(query.error, { op: 'load-chat-context', sessionId });
    toast.error('Couldn’t load chat details. Reload to try again.');
  }, [query.error, sessionId]);
  return query;
}
