import { cn } from '@/lib/utils';

// A button or link styled as text. The class helper lets <Link> and <a> rows wear the same face.

export function rowActionClass({ destructive = false }: { destructive?: boolean } = {}): string {
  return cn(
    // On phones the face grows to a 44px target. inline-flex centres the
    // label in it for links and spans too (a button centres on its own), and
    // justify-end keeps it flush with the row's right edge.
    'max-sm:inline-flex max-sm:min-h-11 max-sm:min-w-11 max-sm:items-center max-sm:justify-end max-sm:text-body',
    'rounded-sm text-title-card font-semibold',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    destructive
      ? 'text-destructive hover:text-destructive/80'
      : 'text-foreground hover:text-muted-foreground',
  );
}

export function RowAction({
  destructive = false,
  className,
  type,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(rowActionClass({ destructive }), className)}
      {...rest}
    />
  );
}
