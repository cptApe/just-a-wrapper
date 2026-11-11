'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/layouts/error-state';
import { captureException } from '@/lib/observability-client';

// error.tsx for the authed app shell (library, scheduled, tools, task). Catches
// render errors escaping any of those pages and their islands' boundaries, and
// renders the shared ErrorState inside the shell chrome so the sidebar survives.
// Next 16.2 recovery uses unstable_retry (re-fetch + re-render); reset alone
// would re-throw a transient data error immediately.
export default function ShellError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: 'app-shell' });
  }, [error]);

  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <ErrorState code={error.digest} onRetry={unstable_retry} />
    </div>
  );
}
