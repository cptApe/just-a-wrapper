import { IconFileQuestion01 } from '@/components/icons';
import { cn } from '@/lib/utils';

export function PreviewNotice({
  title,
  message,
  action,
  retry,
  borderless = false,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
  retry?: () => void;
  /** Overlay bodies are already framed by their modal. */
  borderless?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        !borderless && 'rounded-lg border border-dashed',
      )}
    >
      <div className="text-muted-foreground">
        <IconFileQuestion01 className="size-5" />
      </div>
      <p className="text-title-card font-semibold">{title}</p>
      <p className="max-w-sm text-meta text-muted-foreground">{message}</p>
      {action ? <div className="mt-1">{action}</div> : null}
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="mt-1 text-meta text-foreground underline underline-offset-2 max-md:min-h-11"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
