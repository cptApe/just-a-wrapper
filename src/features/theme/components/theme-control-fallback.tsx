'use client';

import * as React from 'react';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import type { ThemeMode, ThemeToken } from '../types';

export function themeToken(tokens: readonly ThemeToken[], name: string): ThemeToken | undefined {
  return tokens.find((candidate) => candidate.name === name);
}

/** Shown when a named control's token is missing from the theme; the gap is reported once. */
export function ThemeControlFallback({
  label,
  token,
  mode,
  reason,
}: {
  label: string;
  token: string;
  mode: ThemeMode;
  reason: 'missing' | 'unresolved';
}) {
  React.useEffect(() => {
    captureException(
      new AppError('UNEXPECTED', 'Could not render a named theme control.', {
        token,
        mode,
        reason,
      }),
      { op: 'theme.named-control-fallback' },
    );
  }, [mode, reason, token]);
  return (
    <div
      role="status"
      className="flex h-11 min-w-0 items-center rounded-lg bg-alpha-6 px-2.5 text-meta text-muted-foreground"
    >
      <span className="truncate">{label} unavailable</span>
    </div>
  );
}
