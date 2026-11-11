import { cn } from '@/lib/utils';
import type { ModalPresentation, ModalSide, ModalSize } from './modal';

const DIALOG_MAX_W: Record<ModalSize, string> = {
  sm: 'max-w-[480px]',
  default: 'max-w-[560px]',
  lg: 'max-w-page',
};

// Phone sheet (below `sm`): every dialog and fullscreen frame rises from the
// bottom edge at full width with top corners only, the way native sheets do.
// The panel pads the home indicator itself so the footer's actions stay above
// it, and the slide replaces the desktop zoom.
const PHONE_SHEET = cn(
  'max-sm:max-w-full max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]',
  'max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100',
  'max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom',
);

const SHEET_W: Record<ModalSize, string> = {
  sm: 'w-[320px]',
  default: 'w-[480px]',
  lg: 'w-[640px]',
};

export function modalPanelClassName({
  presentation,
  size,
  side,
  mobile,
  resizing,
  floating,
  className,
}: {
  presentation: ModalPresentation;
  size: ModalSize;
  side: ModalSide;
  mobile: 'bottomSheet' | 'dialog';
  resizing: boolean;
  floating: boolean;
  className: string | undefined;
}): string {
  const isCanvas = presentation === 'canvas';
  return cn(
    // Use bg-popover directly, NOT bg-[hsl(var(--popover))]: --popover already
    // contains its own hsl() wrapper (globals.css), so re-wrapping yields
    // invalid CSS the browser drops.
    'relative flex flex-col overflow-hidden bg-popover focus:outline-none',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
    presentation === 'dialog' &&
      cn(
        'pointer-events-auto w-full rounded-xl',
        'max-h-[min(85dvh,800px)]',
        DIALOG_MAX_W[size],
        'duration-[400ms] ease-[var(--ease-ios-sheet)]',
        'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
        // The frame pins the sheet to the bottom and keeps the status bar clear.
        mobile === 'bottomSheet' && cn(PHONE_SHEET, 'max-sm:max-h-full'),
      ),
    presentation === 'fullscreen' &&
      cn(
        'fixed inset-6 z-dialog rounded-xl lg:inset-8',
        'duration-[400ms] ease-[var(--ease-ios-sheet)]',
        'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
        // On a phone the biggest frame is the tallest sheet: edge to edge,
        // below the status bar with a strip of page above it.
        cn(
          PHONE_SHEET,
          'max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-[calc(env(safe-area-inset-top)+1rem)]',
        ),
      ),
    presentation === 'sheet' &&
      cn(
        'fixed inset-y-3 z-dialog rounded-xl',
        SHEET_W[size],
        'max-w-[calc(100vw-1.5rem)]',
        'ease-[var(--ease-ios-sheet)]',
        'data-[state=open]:duration-[500ms] data-[state=closed]:duration-300',
        side === 'right'
          ? 'right-3 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right'
          : 'left-3 data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
      ),
    isCanvas &&
      cn(
        'ease-[var(--ease-ios-sheet)]',
        'data-[state=open]:duration-[500ms] data-[state=closed]:duration-300',
        'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        resizing && 'duration-0',
        floating
          ? cn(
              // The floating card: inset like a modal, never edge-touching.
              // bg-popover like every other overlay surface, so the configured
              // Dialog colour reaches it; shadow-popover is the one
              // sanctioned floating shadow and carries the hairline ring
              // both themes need without a scrim.
              'fixed inset-y-3 right-3 z-dialog rounded-xl',
              'max-w-[calc(100vw-1.5rem)] bg-popover shadow-popover',
            )
          : cn(
              'fixed inset-y-0 right-0 z-dialog h-dvh rounded-l-xl',
              // Dark mode needs the seam over a same-darkness page (the one
              // sanctioned dark hairline, as an inset ring — never a border).
              'dark:shadow-[inset_0_0_0_1px_var(--color-alpha-6)]',
            ),
      ),
    className,
  );
}
