'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/layouts/error-state';
import { captureException } from '@/lib/observability-client';

// error.tsx for the auth surface (login). A standalone full-screen page, so the
// fallback centers in the viewport. Recovery uses unstable_retry (re-fetch +
// re-render); reset alone would re-throw a transient data error.
export default function AuthError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: 'auth' });
  }, [error]);

  return (
    <div className="grid min-h-dvh place-items-center">
      <ErrorState code={error.digest} onRetry={unstable_retry} />
    </div>
  );
}
