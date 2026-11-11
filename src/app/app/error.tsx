'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/layouts/error-state';
import { captureException } from '@/lib/observability-client';

// The (shell) and settings boundaries cannot catch their own segment's layout,
// so a failed session read in those layouts lands here. It stays inside the app
// and never redirects: a failed read says nothing about whether the user is
// signed in. Recovery uses unstable_retry so the failed read runs again.
export default function AppSegmentError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: 'app-segment' });
  }, [error]);

  return (
    <div className="grid min-h-dvh place-items-center">
      <ErrorState
        title="We could not load your workspace"
        message="This is usually a brief connection problem. Try again in a moment."
        code={error.digest}
        onRetry={unstable_retry}
      />
    </div>
  );
}
