import { cn } from '@/lib/utils';

// Rows own their padding; pass non-row content as one child. divided defaults to true; borderless pages pass divided={false}.
export function SettingsSection({
  title,
  description,
  hint,
  action,
  divided = true,
  children,
  className,
  ...rest
}: {
  /** ≤3-word noun; omit for a bare row stack. */
  title?: string;
  /** One sentence of context under the title, full stop. */
  description?: string;
  /** Optional InfoHint rendered after the section title. */
  hint?: React.ReactNode;
  /** Optional trailing action (a RowAction / link), right-aligned with the title. */
  action?: React.ReactNode;
  /** Draw the between-row hairline (default). `false` = borderless rows. */
  divided?: boolean;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section className={cn('flex flex-col gap-1 pt-12 first:pt-0', className)} {...rest}>
      {title ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="flex items-center gap-1.5 text-title-section">
              {title}
              {hint}
            </h2>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
          {description ? <p className="text-meta text-muted-foreground">{description}</p> : null}
        </div>
      ) : null}
      <div className={cn('flex flex-col', divided && 'divide-y divide-border', title && 'pt-2')}>
        {children}
      </div>
    </section>
  );
}
