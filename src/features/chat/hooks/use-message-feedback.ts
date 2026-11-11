'use client';
import { useQuery } from '@tanstack/react-query';
import { AppError } from '@/lib/errors';
import { chatQueryKeys } from '../api/keys';
import { getMessageFeedback } from '../api/message-feedback';

export function useMessageFeedback(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: chatQueryKeys.feedback(sessionId),
    enabled,
    queryFn: async () => {
      const response = await getMessageFeedback(sessionId);
      if (!response.ok) throw new AppError('API_REQUEST_FAILED', response.message);
      return response.data;
    },
  });
}
