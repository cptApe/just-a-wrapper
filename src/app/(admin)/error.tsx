'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/layouts/error-state';
import { captureException } from '@/lib/observability-client';

// Most likely a page reading a config file that has moved or stopped parsing.
export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: 'admin' });
  }, [error]);

  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <ErrorState
        title="This admin page could not load"
        message="The file behind it may have moved or stopped parsing. Try again, and check the source files listed on the page."
        code={error.digest}
        onRetry={unstable_retry}
      />
    </div>
  );
}
