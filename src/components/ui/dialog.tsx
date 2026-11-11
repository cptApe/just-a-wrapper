'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';
import { IconX } from '@/components/icons';
import { focusFirstTextField } from '@/components/ui/modal/focus-first-field';
import { cn } from '@/lib/utils';

// New overlays use the Modal family in ui/modal/ (09-modals). The sidebar task rename, the
// shared Delete task confirm and the theme save dialog are its only consumers; add no others.

export const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // The overlay alone separates the panel: no backdrop blur, no panel shadow.
      'fixed inset-0 z-dialog bg-overlay',
      'duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  hideClose?: boolean;
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideClose, onOpenAutoFocus, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onOpenAutoFocus={onOpenAutoFocus ?? focusFirstTextField}
      className={cn(
        'fixed left-1/2 top-1/2 z-dialog -translate-x-1/2 -translate-y-1/2',
        // Use bg-popover directly: --popover already contains its own hsl()
        // wrapper, so bg-[hsl(var(--popover))] would be invalid CSS.
        'bg-popover rounded-xl',
        'duration-[400ms] ease-[var(--ease-ios-sheet)]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
        'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
        'w-[calc(100vw-2rem)] max-w-[560px] p-6',
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        // Close = 28-in-36 icon pill: a 36px hit target whose visible pill is
        // the 28px hover fill.
        <DialogPrimitive.Close
          className={cn(
            'group absolute right-4 top-4 inline-flex size-9 items-center justify-center',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-button',
          )}
          aria-label="Close"
        >
          <span
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-button',
              'bg-alpha-6 text-muted-foreground',
              'transition-colors duration-150 ease-[var(--ease-out)]',
              'group-hover:bg-alpha-12 group-hover:text-foreground',
            )}
            aria-hidden
          >
            <IconX className="size-4" />
          </span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 mb-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6', className)}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-title-section font-semibold leading-tight tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-meta text-muted-foreground leading-relaxed', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-4', className)} {...props} />;
}
