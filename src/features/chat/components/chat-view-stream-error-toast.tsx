'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { EventStream } from '../hooks/use-event-stream';
import { streamErrorMessage } from '../lib/stream-errors';

export function ChatViewStreamErrorToast({
  sessionId,
  error,
  remint,
}: {
  sessionId: string;
  error: EventStream['meta']['error'];
  remint: EventStream['remint'];
}) {
  const pathname = usePathname();
  const toastId = `chat-error-${sessionId}`;

  useEffect(() => {
    if (!error) return;
    toast.error(streamErrorMessage(error), {
      id: toastId,
      duration: Infinity,
      action: {
        label: error.code === 'ACCESS_LOST' ? 'Sign in' : 'Retry',
        onClick: (event) => {
          // Keep the error visible until the replacement connection opens.
          event.preventDefault();
          if (error.code === 'ACCESS_LOST') {
            window.location.assign(`/login?next=${encodeURIComponent(pathname)}`);
          } else {
            remint();
          }
        },
      },
    });
    return () => {
      toast.dismiss(toastId);
    };
  }, [error, pathname, remint, toastId]);
  return null;
}
