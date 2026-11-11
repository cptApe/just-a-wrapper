import type { Icon } from '@/components/icons';
import { cn } from '@/lib/utils';

// A persistent warning that stays while the problem exists. Results of an action
// are toasts, and failed page loads use ErrorState.
export function WarningBar({
  icon: Icon,
  message,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  icon: Icon;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      {...props}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3',
        className,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 grow basis-40 text-body font-medium">{message}</p>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
