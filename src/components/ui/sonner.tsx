'use client';

import { Toaster as Sonner } from 'sonner';
import {
  IconAlertCircleSolid,
  IconAlertTriangleSolid,
  IconCheckCircleSolid,
  IconInfoCircleSolid,
} from '@/components/icons';
import { useTheme } from '@/components/theme/theme-provider';
import { buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Toasts are the app's one transient confirmation surface: the
// popover/card surface in light, the unified dark-glass menu language in dark.
// Sonner portals to <body>, so both themes key off the global `.dark` class and
// the surface reads identically to a real in-app toast.
//
// `unstyled` is load-bearing: sonner's defaults are applied at
// `[data-sonner-toast][data-styled='true']` (specificity 0,2,0), which beats our
// single-class utilities — with it on, our surface/radius/colours never took and
// you saw sonner's own greys + 8px corners. Unstyled strips all of that, so we
// own the full surface and layout here, entirely on house tokens.
const iconClasses = 'size-5';

export function Toaster(props: ToasterProps) {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="top-right"
      className="toaster group"
      // Filled Untitled UI glyphs (icon hard rule) in our vivid sentiment
      // tokens: success-strong (green) and destructive-strong (red), the two
      // glanceable status colours defined in globals.css with per-theme values.
      // Loading is the shadcn Spinner, never sonner's default loader.
      icons={{
        success: <IconCheckCircleSolid className={cn(iconClasses, 'text-success-strong')} />,
        error: <IconAlertCircleSolid className={cn(iconClasses, 'text-destructive-strong')} />,
        warning: <IconAlertTriangleSolid className={cn(iconClasses, 'text-warning')} />,
        info: <IconInfoCircleSolid className={cn(iconClasses, 'text-info')} />,
        loading: (
          <Spinner
            className={cn(iconClasses, 'text-muted-foreground dark:text-glass-fg-secondary')}
          />
        ),
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: cn(
            // Layout sonner normally supplies (it is gone under `unstyled`).
            'flex w-full items-center gap-3 p-4',
            // Radius: the extra large size, shared with dialogs and the EmptyState
            // container. Never square.
            'rounded-xl',
            // Light: the popover/card surface — hairline border, whisper shadow.
            'border border-border bg-popover text-popover-foreground shadow-popover',
            // Dark: the one dark-glass surface shared with menus (glass-* tokens).
            'dark:border-transparent dark:bg-glass-bg dark:text-glass-fg dark:shadow-glass dark:backdrop-blur-2xl',
          ),
          // `relative` + fixed size so sonner's absolutely-positioned loader
          // (position:absolute; top/left:50%) centres inside the icon slot on the
          // left, not against the whole toast — its layout is gone under unstyled.
          icon: 'relative flex size-5 shrink-0 items-center justify-center',
          // `grow` fills the row so any action/cancel button is pushed to the
          // right edge (the flex-grow sonner normally supplies is gone too).
          content: 'flex min-w-0 grow flex-col gap-0.5',
          title: 'text-body font-medium',
          description: 'text-meta text-muted-foreground dark:text-glass-fg-secondary',
          // The action + cancel ARE our <Button> (secondary / ghost, sm). Under
          // `unstyled` sonner adds no button chrome, so the cva applies cleanly.
          actionButton: cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0'),
          cancelButton: cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'shrink-0'),
        },
      }}
      {...props}
    />
  );
}
