'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/layouts/error-state';
import { captureException } from '@/lib/observability-client';

// Recover unexpected task render errors inside the task boundary so the shell remains usable.
// ChatView handles missing access and stream errors; unstable_retry handles this boundary.
export default function TaskError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: 'app-task' });
  }, [error]);

  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <ErrorState code={error.digest} onRetry={unstable_retry} />
    </div>
  );
}
