'use client';

import * as React from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { AppError } from '@/lib/errors';

type ErrorRender = (args: { error: Error; reset: () => void }) => React.ReactNode;

/**
 * Pair Suspense + ErrorBoundary so neither ships without the other.
 * If you find yourself reaching for raw `<Suspense>` or `<ErrorBoundary>`,
 * use this instead. PR review enforces.
 */
export function Boundary({
  children,
  loading,
  error,
}: {
  children: React.ReactNode;
  loading: React.ReactNode;
  error: React.ReactNode | ErrorRender;
}) {
  const inner = <React.Suspense fallback={loading}>{children}</React.Suspense>;

  if (typeof error === 'function') {
    const renderFn: ErrorRender = error;
    return (
      <ErrorBoundary
        fallbackRender={({ error: e, resetErrorBoundary }: FallbackProps) =>
          renderFn({
            error:
              e instanceof Error
                ? e
                : new AppError('UNEXPECTED', 'Rendering failed', {}, { cause: e }),
            reset: resetErrorBoundary,
          })
        }
      >
        {inner}
      </ErrorBoundary>
    );
  }

  return <ErrorBoundary fallback={<>{error}</>}>{inner}</ErrorBoundary>;
}
