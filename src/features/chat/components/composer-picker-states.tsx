'use client';

import { type Icon, IconAlertCircle, IconRefreshCcw01 } from '@/components/icons';
import { Button } from '@/components/ui/button';

// The non-success states shared by the composer's canvas pickers (Library,
// skills). Loading uses each surface's shaped skeleton; empty and error are
// centered messages so both pickers read identically (code-standards: loading /
// empty / success / error, every time).

export function PickerEmpty({
  icon: EmptyIcon,
  title,
  hint,
}: {
  icon: Icon;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <EmptyIcon className="size-8 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <p className="mt-4 text-title-card text-foreground">{title}</p>
      <p className="mt-1 max-w-xs text-meta text-muted-foreground">{hint}</p>
    </div>
  );
}

export function PickerError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center"
    >
      <IconAlertCircle className="size-8 text-destructive" strokeWidth={1.5} aria-hidden />
      <p className="mt-4 text-title-card text-foreground">Couldn’t load this</p>
      <p className="mt-1 max-w-xs text-meta text-muted-foreground">{message}</p>
      <Button variant="secondary" size="sm" className="mt-4 gap-1.5" onClick={onRetry}>
        <IconRefreshCcw01 className="size-4" />
        Try again
      </Button>
    </div>
  );
}
