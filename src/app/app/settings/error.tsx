'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/layouts/error-state';
import { captureException } from '@/lib/observability-client';

// error.tsx for the settings rail (account, billing, members, usage, …). Catches
// render errors escaping any settings page and renders the shared ErrorState
// inside the settings chrome. Recovery uses unstable_retry (re-fetch + re-render).
export default function SettingsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: 'app-settings' });
  }, [error]);

  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <ErrorState code={error.digest} onRetry={unstable_retry} />
    </div>
  );
}
