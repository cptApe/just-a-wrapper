import * as React from 'react';
import { IconAlertTriangle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  title?: string;
  message?: string;
  /** Stable error code from `AppError.code` — shown small + monospaced for support. */
  code?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'Try again, or refresh if the problem persists.',
  code,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center px-6 py-12',
        className,
      )}
      role="alert"
    >
      <div className="inline-flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <IconAlertTriangle className="size-5" />
      </div>
      <div className="flex flex-col gap-1 max-w-[420px]">
        <p className="text-title-card font-semibold text-foreground">{title}</p>
        <p className="text-meta text-muted-foreground">{message}</p>
        {code && <p className="text-[11px] font-mono text-muted-foreground mt-1">{code}</p>}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      )}
    </div>
  );
}
