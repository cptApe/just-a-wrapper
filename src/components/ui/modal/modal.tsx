'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { FocusScope } from '@radix-ui/react-focus-scope';
import * as React from 'react';
import { IconX } from '@/components/icons';
import { CANVAS_EDGE_GAP, useCanvasWidth } from '@/hooks/use-canvas-width';
import { AppError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { CanvasResizeHandle } from './canvas-resize-handle';
import { focusFirstTextField } from './focus-first-field';
import { ModalIconButton } from './modal-icon-button';
import { modalPanelClassName } from './modal-panel-class-name';

// The Modal family (09-modals spec) — ONE overlay component, four presentations:
//
//   dialog     — centered, content-sized height, max-w by `size`.
//   canvas     — right side panel beside the page (non-modal, resizable).
//                `floating` opts into the inset-card variant that pushes /app
//                content aside at wide viewports (see the block below).
//   sheet      — floating side sheet with an edge gap.
//   fullscreen — viewport minus a 24-32px edge gap.
//
// Geometry contract:
// panel radius 24, popover surface, NO shadow; overlay token at 60% black
// with no blur; header is a 3-column grid (minmax(36px,1fr) auto
// minmax(36px,1fr)) with the title centered and a 28-in-36 close pill on the
// right; footer carries the actions, primary rightmost. Header and footer are
// sticky chrome: chromeless at rest, hairline once content scrolls behind them
// (scroll-edge indication via ModalContent's sentinels).
//
// Variants are composition, not props: omit `closable` for a non-dismissable
// modal, omit ModalHeader for a floating close over content, pass `onBack` +
// a ModalFooter `left` slot for multistep.

export type ModalPresentation = 'dialog' | 'canvas' | 'sheet' | 'fullscreen';
export type ModalSize = 'sm' | 'default' | 'lg';
export type ModalSide = 'left' | 'right';

const CANVAS_DEFAULT_W = 640;

interface ScrollEdges {
  atTop: boolean;
  atBottom: boolean;
}

// The overlay alone separates the panel: no backdrop blur, no panel shadow.
const BACKDROP_CLASS_NAME = cn(
  'fixed inset-0 z-dialog bg-overlay',
  'duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
);

const RESTING_EDGES: ScrollEdges = { atTop: true, atBottom: true };

interface ModalContextValue {
  closable: boolean;
  showClose: boolean;
  edges: ScrollEdges;
  setEdges: React.Dispatch<React.SetStateAction<ScrollEdges>>;
  setHasHeader: (mounted: boolean) => void;
  setHasDescription: (mounted: boolean) => void;
}

const ModalContext = React.createContext<ModalContextValue | null>(null);

export function useModal(component: string): ModalContextValue {
  const ctx = React.useContext(ModalContext);
  if (!ctx) {
    // Developer misuse, not a runtime condition — surface it loudly.
    throw new AppError('UNEXPECTED', `${component} must be rendered inside <Modal>`);
  }
  return ctx;
}

export const ModalClose = DialogPrimitive.Close;

export interface ModalProps {
  modal?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  presentation?: ModalPresentation;
  /** dialog: max-width 480/560/960 · sheet: width 320/480/640. */
  size?: ModalSize;
  /** sheet only; canvas is always the right edge. */
  side?: ModalSide;
  /** false = no close affordance, no ESC, no outside-click dismiss. */
  closable?: boolean;
  /** false hides the visible close pill while KEEPING Esc + outside-click
      dismissal — for surfaces that dismiss ambiently (the ⌘K command palette),
      where a close "x" next to the input reads as a text-clear. */
  showClose?: boolean;
  /** Dialog only: below sm the dialog is a full-width bottom sheet with top
   * corners and a slide-up entrance (the default). 'dialog' keeps the
   * centered card on phones too. */
  mobile?: 'bottomSheet' | 'dialog';
  /** Rendered as the Radix trigger (asChild) for uncontrolled usage. */
  trigger?: React.ReactNode;
  /** canvas only: drag handle on the left edge. */
  resizable?: boolean;
  /** canvas only: the floating-card variant — inset card, bg-background,
      persisted width, pushes /app content aside at wide viewports and floats
      over it below the breakpoint. Opt-in; the default canvas is unchanged. */
  floating?: boolean;
  /** canvas only: initial width before the user resizes. */
  defaultWidth?: number;
  /** canvas only: lock the panel to exactly this width. It bypasses the shared
      stored floating width, the viewport reclamp and the resize handle, and is
      never written back to storage — so a narrow fixed canvas (the preview's
      list frame) neither inherits nor disturbs the size a user gave the
      resizable preview canvas. */
  width?: number;
  /** Radix close-focus hook — for modals opened programmatically (no
      DialogTrigger), where the caller must restore focus to the opener
      itself (e.g. the ⌘K command menu's sidebar button). */
  onCloseAutoFocus?: (event: Event) => void;
  /** Extra classes on the panel (width/height overrides). */
  className?: string;
  children: React.ReactNode;
}

export function Modal({
  modal,
  open,
  defaultOpen,
  onOpenChange,
  presentation = 'dialog',
  size = 'default',
  side = 'right',
  closable = true,
  showClose = true,
  mobile = 'bottomSheet',
  trigger,
  resizable = false,
  floating = false,
  defaultWidth = CANVAS_DEFAULT_W,
  width,
  onCloseAutoFocus,
  className,
  children,
}: ModalProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const isOpen = open ?? uncontrolledOpen;
  const isModal = modal ?? presentation !== 'canvas';
  const [edges, setEdges] = React.useState<ScrollEdges>(RESTING_EDGES);
  const [hasHeader, setHasHeader] = React.useState(false);
  const [hasDescription, setHasDescription] = React.useState(false);
  const fixedWidth = width !== undefined;
  const isCanvas = presentation === 'canvas';
  const { canvasWidth, minWidth, maxWidth, resizing, setResizing, applyUserResize } =
    useCanvasWidth({
      width,
      defaultWidth,
      floating,
      presentation,
      open: isOpen,
    });
  const context = React.useMemo<ModalContextValue>(
    () => ({
      closable,
      showClose,
      edges,
      setEdges,
      setHasHeader,
      setHasDescription,
    }),
    [closable, showClose, edges, setHasHeader, setHasDescription],
  );

  React.useEffect(() => {
    if (!isOpen || isCanvas || isModal) return;
    // The stable non-modal Radix tree keeps preview children mounted; expansion owns its scroll lock.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isOpen, isCanvas, isModal]);

  const panel = (
    <DialogPrimitive.Content
      // The canvas sits beside a live page; only true dialogs pull focus into a field.
      onOpenAutoFocus={isCanvas ? undefined : focusFirstTextField}
      onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={closable ? undefined : (e) => e.preventDefault()}
      onInteractOutside={(e) => {
        // The canvas sits beside an interactive page — outside interaction is
        // the point, not a dismissal. Non-closable modals dismiss only via
        // their own actions.
        if (!closable || isCanvas || (!isModal && e.detail.originalEvent.type === 'focusin'))
          e.preventDefault();
      }}
      // Radix react-dialog@1.1.15 sets role="dialog" but never emits aria-modal;
      // it delivers modality via aria-hidden on outside content + focus trap.
      // Add the literal attribute so AT that keys off aria-modal reads these as
      // modal — EXCEPT the canvas, which is genuinely non-modal (modal={false},
      // it sits beside a live page) and must not claim aria-modal.
      aria-modal={!isCanvas ? true : undefined}
      {...(hasDescription ? {} : { 'aria-describedby': undefined })}
      className={modalPanelClassName({
        presentation,
        size,
        side,
        mobile,
        resizing,
        floating,
        className,
      })}
      style={isCanvas ? { width: canvasWidth } : undefined}
    >
      <ModalContext.Provider value={context}>
        {children}
        {closable && showClose && !hasHeader ? (
          // No-header composition: the close pill floats top-right over the content.
          <DialogPrimitive.Close asChild>
            <ModalIconButton
              label="Close"
              filled
              className="absolute right-3.5 top-3.5 z-10 max-sm:right-2 max-sm:top-1.5"
            >
              <IconX className="size-4" />
            </ModalIconButton>
          </DialogPrimitive.Close>
        ) : null}
        {isCanvas && resizable && !fixedWidth ? (
          <CanvasResizeHandle
            resizing={resizing}
            width={canvasWidth}
            minWidth={minWidth}
            maxWidth={maxWidth}
            rightInset={floating ? CANVAS_EDGE_GAP : 0}
            onResizingChange={setResizing}
            onWidthChange={applyUserResize}
          />
        ) : null}
      </ModalContext.Provider>
    </DialogPrimitive.Content>
  );

  // Non-modal Radix content stays mounted while the preview gains a fullscreen focus trap.
  const focusedPanel = isModal ? (
    panel
  ) : (
    <FocusScope
      asChild
      loop
      trapped={!isCanvas}
      onMountAutoFocus={(event) => event.preventDefault()}
      onUnmountAutoFocus={(event) => event.preventDefault()}
    >
      {panel}
    </FocusScope>
  );

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(next) => {
        setUncontrolledOpen(next);
        onOpenChange?.(next);
      }}
      modal={isModal}
    >
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        {!isCanvas && !isModal ? (
          <div
            aria-hidden
            data-state={isOpen ? 'open' : 'closed'}
            className={BACKDROP_CLASS_NAME}
          />
        ) : !isCanvas ? (
          <DialogPrimitive.Overlay className={BACKDROP_CLASS_NAME} />
        ) : null}
        {presentation === 'dialog' ? (
          // Centering frame: lets the panel stay content-sized with a sane
          // max-height; clicks land on the overlay through it (body is
          // pointer-events:none while a modal is open, so this div is inert).
          <div
            className={cn(
              'pointer-events-none fixed inset-0 z-dialog flex items-center justify-center p-4',
              mobile === 'bottomSheet' &&
                'max-sm:items-end max-sm:p-0 max-sm:pt-[calc(env(safe-area-inset-top)+1rem)]',
            )}
          >
            {focusedPanel}
          </div>
        ) : (
          focusedPanel
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
