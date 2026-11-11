'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';
import { IconArrowLeft, IconX } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useModal } from './modal';
import { ModalIconButton } from './modal-icon-button';

// The three sections of a Modal (09-modals spec):
//
//   ModalHeader  — sticky chrome. Back pill (left) · title (center, or absent)
//                  · frame controls + close pill (right). Actions NEVER live
//                  here — they belong in the footer.
//   ModalContent — the ONLY scrollable region. Owns the scroll-edge sentinels.
//   ModalFooter  — sticky chrome. Action row, primary rightmost; `left` slot
//                  for progress / secondary meta.
//
// Header and footer are chromeless at rest and gain a hairline (a box-shadow,
// so no reflow) only while content is scrolled behind them.

const HEADER_HAIRLINE = 'shadow-[0_1px_0_0_var(--color-alpha-8)]';
const FOOTER_HAIRLINE = 'shadow-[0_-1px_0_0_var(--color-alpha-8)]';

export interface ModalHeaderProps {
  /** Renders the ← pill in the left slot (multistep). */
  onBack?: () => void;
  /**
   * center (default): 3-column dialog grid, title centered.
   * start: title + meta stack on the left (canvas / fullscreen, dialog-04).
   */
  align?: 'center' | 'start';
  /**
   * Icon-only frame controls (nav arrows, expand toggle) rendered left of the
   * close pill. Frame controls operate the modal itself — content actions
   * (Connect, Save, …) belong in ModalFooter.
   */
  controls?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function ModalHeader({
  onBack,
  align = 'center',
  controls,
  className,
  children,
}: ModalHeaderProps) {
  const { closable, showClose, edges, setHasHeader } = useModal('ModalHeader');

  // Registration (layout effect = before paint, no floating-X flash) lets the
  // panel know not to render the floating close pill.
  React.useLayoutEffect(() => {
    setHasHeader(true);
    return () => setHasHeader(false);
  }, [setHasHeader]);

  const backPill = onBack ? (
    <ModalIconButton label="Back" onClick={onBack}>
      <IconArrowLeft className="size-4" />
    </ModalIconButton>
  ) : null;

  const closePill =
    closable && showClose ? (
      <DialogPrimitive.Close asChild>
        <ModalIconButton label="Close" filled>
          <IconX className="size-4" />
        </ModalIconButton>
      </DialogPrimitive.Close>
    ) : null;

  return (
    <header
      className={cn(
        'relative z-10 shrink-0 transition-[box-shadow] duration-150 ease-[var(--ease-out)]',
        !edges.atTop && HEADER_HAIRLINE,
        align === 'center'
          ? 'grid min-h-16 grid-cols-[minmax(2.25rem,1fr)_minmax(0,auto)_minmax(2.25rem,1fr)] items-center gap-3 px-5'
          : 'flex min-h-16 items-center gap-3 px-5 py-3',
        // Phone: a 56px bar whose 44px pills hug the 16px page gutter, so the
        // visible 28px fill lines up with the content edge below it.
        align === 'center'
          ? 'max-sm:min-h-14 max-sm:px-2'
          : 'max-sm:min-h-14 max-sm:pl-4 max-sm:pr-2 max-sm:py-1.5',
        className,
      )}
    >
      {align === 'center' ? (
        <>
          <div className="flex justify-start">{backPill}</div>
          <div className="min-w-0 text-center">{children}</div>
          <div className="flex items-center justify-end gap-1">
            {controls}
            {closePill}
          </div>
        </>
      ) : (
        <>
          {backPill}
          <div className="min-w-0 flex-1">{children}</div>
          <div className="flex shrink-0 items-center gap-1">
            {controls}
            {closePill}
          </div>
        </>
      )}
    </header>
  );
}

export const ModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & {
    /** 'scroll': the content carries its own large title, so the header title
     *  stays hidden at the top and fades in once that title scrolls behind
     *  the header (the native large-title pattern). */
    reveal?: 'scroll';
  }
>(({ className, reveal, ...props }, ref) => {
  const { edges } = useModal('ModalTitle');
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn(
        'text-title-section font-semibold leading-tight tracking-tight',
        reveal === 'scroll' &&
          cn(
            'truncate text-title-card transition-opacity duration-150 ease-[var(--ease-out)]',
            edges.atTop ? 'opacity-0' : 'opacity-100',
          ),
        className,
      )}
      {...props}
    />
  );
});
ModalTitle.displayName = 'ModalTitle';

export const ModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => {
  const { setHasDescription } = useModal('ModalDescription');
  React.useLayoutEffect(() => {
    setHasDescription(true);
    return () => setHasDescription(false);
  }, [setHasDescription]);
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-meta leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  );
});
ModalDescription.displayName = 'ModalDescription';

export function ModalContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { setEdges } = useModal('ModalContent');
  const rootRef = React.useRef<HTMLDivElement>(null);
  const topRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  // Scroll-edge indication: 1px sentinels at the content's real top/bottom,
  // observed within the scroll root. No scroll listeners, no rAF, handles
  // content/viewport resizes for free.
  React.useEffect(() => {
    const root = rootRef.current;
    const top = topRef.current;
    const bottom = bottomRef.current;
    if (!root || !top || !bottom) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        setEdges((prev) => {
          let next = prev;
          for (const entry of entries) {
            if (entry.target === top && entry.isIntersecting !== next.atTop) {
              next = { ...next, atTop: entry.isIntersecting };
            } else if (entry.target === bottom && entry.isIntersecting !== next.atBottom) {
              next = { ...next, atBottom: entry.isIntersecting };
            }
          }
          return next;
        });
      },
      { root },
    );
    observer.observe(top);
    observer.observe(bottom);
    return () => {
      observer.disconnect();
      setEdges({ atTop: true, atBottom: true });
    };
  }, [setEdges]);

  // Reserve 4px inside the scroll clip for the 2px focus ring + 1px offset,
  // even when a consumer removes the content padding. Total default spacing
  // stays 32px horizontally (16px on phones, the page gutter), 4px above, and
  // 24px below the content.
  return (
    <div
      ref={rootRef}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-1"
    >
      <div ref={topRef} aria-hidden className="h-px shrink-0" />
      <div className={cn('flex grow flex-col px-7 pb-5 max-sm:px-3', className)}>{children}</div>
      <div ref={bottomRef} aria-hidden className="h-px shrink-0" />
    </div>
  );
}

export function ModalFooter({
  left,
  className,
  children,
}: {
  /** Progress dots / secondary meta — sits opposite the action cluster. */
  left?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const { edges } = useModal('ModalFooter');
  return (
    <footer
      className={cn(
        'relative z-10 flex shrink-0 items-center gap-3 px-5 pb-5 pt-4 max-sm:px-4 max-sm:pb-4 max-sm:pt-3',
        'transition-[box-shadow] duration-150 ease-[var(--ease-out)]',
        !edges.atBottom && FOOTER_HAIRLINE,
        left ? 'justify-between' : 'justify-end',
        className,
      )}
    >
      {left ? <div className="flex min-w-0 items-center gap-3">{left}</div> : null}
      {/* Phone: without a left slot the actions share the full row in equal
          widths, primary still rightmost, within easy reach of the thumb. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-3',
          !left && 'max-sm:min-w-0 max-sm:flex-1 max-sm:*:flex-1',
        )}
      >
        {children}
      </div>
    </footer>
  );
}
