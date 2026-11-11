// Shared classes for the schedule builder's inline controls. They are the
// app's own controls (Input / Select / Button tokens), not a per-feature look:
// pills are the alpha-6 input surface, menus and items use the Select defaults.
export const SCHEDULE_PILL =
  'inline-flex h-8 w-auto max-w-full items-center justify-between gap-2 rounded-button border-0 bg-alpha-6 px-3 text-meta font-medium text-foreground shadow-none inset-shadow-none hover:bg-alpha-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-[state=open]:bg-alpha-8 pointer-coarse:h-9 max-sm:min-h-9';
export const SCHEDULE_TRIGGER_ROW =
  'flex min-h-11 flex-wrap items-center gap-2 rounded-md bg-alpha-6 p-2 pr-12 text-meta leading-6';
export const SCHEDULE_CLOCK =
  'flex size-7 shrink-0 items-center justify-center rounded-full bg-info-strong text-on-media [&>svg]:size-4';
