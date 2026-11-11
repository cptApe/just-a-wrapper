import type { ReactNode } from 'react';
import { TOOL_TEXT_PREVIEW_LIMIT } from '@/components/ui/code-block';
import { cn } from '@/lib/utils';

export function ReadingPane({
  text,
  className,
  emptyText,
  children,
}: {
  text: string;
  className?: string;
  emptyText?: string;
  children?: ReactNode;
}) {
  const shortened = text.length > TOOL_TEXT_PREVIEW_LIMIT;
  const visible = text.slice(0, TOOL_TEXT_PREVIEW_LIMIT);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {shortened ? <p className="text-meta text-muted-foreground">Showing the first part</p> : null}
      <p
        className={cn(
          'max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-meta leading-relaxed text-muted-foreground',
          className,
        )}
      >
        {visible || emptyText}
        {children}
      </p>
    </div>
  );
}
