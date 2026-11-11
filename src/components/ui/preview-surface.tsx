'use client';

import * as React from 'react';
import { z } from 'zod';
import { IconDownload01, IconExpand01, IconMinimize01, IconX } from '@/components/icons';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalIconButton,
  ModalTitle,
  modalIconButtonClassName,
  modalIconPillClassName,
} from '@/components/ui/modal';
import { HoverFocusTooltip, TooltipProvider } from '@/components/ui/tooltip';
import { captureException } from '@/lib/observability-client';

// Shared preview canvas for one item or a narrow picker list.
// Direct actions share the frame bar; labeled actions use the content toolbar.
// Placement persists per preview kind, while the viewport determines push or float.
// List frames keep a fixed narrow width independent of resizable item previews.
// Controls use 44px targets; see docs/spec/09-modals.md.

export type PreviewPlacement = 'side' | 'modal';
export type PreviewSurfaceKind =
  | 'browser-session'
  | 'chart'
  | 'file-preview'
  | 'memory-note'
  | 'session-files';
/** What the frame holds: one item (expandable canvas) or one narrow list
    (fixed narrow canvas, Close only). */
type PreviewFrame = 'preview' | 'list';

const PLACEMENT_STORAGE_KEY_PREFIX = 'overlay:canvas-placement';

/** The list frame's width — the family's `sm` sheet width, so
    the narrow canvas is a sanctioned size, not an invented one. */
const PREVIEW_LIST_WIDTH = 320;

/** 44px square hit target (touch-accessibility floor) laid over the family's
    36px pill; the visible 28px fill is unchanged. */
const PREVIEW_HIT_TARGET = 'size-11';

function placementStorageKey(kind: PreviewSurfaceKind): string {
  return `${PLACEMENT_STORAGE_KEY_PREFIX}:${kind}`;
}

function readStoredPlacement(kind: PreviewSurfaceKind): PreviewPlacement | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(placementStorageKey(kind));
    const parsed = z.enum(['side', 'modal']).safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    // Product rule: when the browser blocks storage, placement is not remembered.
    captureException(error, { op: 'preview.placement-read' });
    return null;
  }
}

function storePlacement(kind: PreviewSurfaceKind, placement: PreviewPlacement): void {
  try {
    window.localStorage.setItem(placementStorageKey(kind), placement);
  } catch (error) {
    // Product rule: when the browser blocks storage, placement is not remembered.
    captureException(error, { op: 'preview.placement-write' });
  }
}

export interface PreviewSurfaceProps {
  /** Stable view type keeps placement memory isolated between preview kinds. */
  kind: PreviewSurfaceKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The item being previewed — header title and the dialog's accessible name. */
  title: string;
  /** The item's direct actions (Download) as frame-bar buttons left of
      Expand and Close, so a preview keeps one top bar and no second toolbar. */
  headerActions?: React.ReactNode;
  /** Optional content toolbar above the content for actions that need a
      label (save, take control). Previews with only Download leave this out. */
  actions?: React.ReactNode;
  /** 'preview' (default): the resizable side canvas with the expand toggle.
      'list': a narrow fixed canvas with Close only, for picking one item. */
  frame?: PreviewFrame;
  /** Placement used before the user has ever picked one. */
  defaultPlacement?: PreviewPlacement;
  children: React.ReactNode;
}

export function PreviewSurface({
  kind,
  open,
  onOpenChange,
  title,
  headerActions,
  actions,
  frame = 'preview',
  defaultPlacement = 'side',
  children,
}: PreviewSurfaceProps) {
  const [placement, setPlacement] = React.useState<PreviewPlacement>(
    () => readStoredPlacement(kind) ?? defaultPlacement,
  );

  function switchPlacement(next: PreviewPlacement) {
    setPlacement(next);
    storePlacement(kind, next);
  }

  const expanded = placement === 'modal';
  const isList = frame === 'list';

  // The frame controls, rendered here rather than by ModalHeader so both get
  // the 44px hit target (the family's own close pill is fixed at 36px). Close
  // stays rightmost, as everywhere in the family. Lists never expand — a
  // narrow column of names has nothing to gain from the whole viewport.
  const controls = (
    <TooltipProvider delayDuration={300}>
      {headerActions}
      {isList ? null : (
        <HoverFocusTooltip side="bottom" content={expanded ? 'Collapse' : 'Expand'}>
          <ModalIconButton
            label={expanded ? 'Collapse' : 'Expand'}
            aria-pressed={expanded}
            className={PREVIEW_HIT_TARGET}
            onClick={() => switchPlacement(expanded ? 'side' : 'modal')}
          >
            {expanded ? <IconMinimize01 className="size-4" /> : <IconExpand01 className="size-4" />}
          </ModalIconButton>
        </HoverFocusTooltip>
      )}
      <ModalClose asChild>
        <ModalIconButton label="Close" filled className={PREVIEW_HIT_TARGET}>
          <IconX className="size-4" />
        </ModalIconButton>
      </ModalClose>
    </TooltipProvider>
  );

  const header = (
    // py-2.5 + 44px controls = the family's 64px header, so the taller hit
    // targets add no height to the frame.
    <ModalHeader align="start" controls={controls} className="py-2.5">
      <ModalTitle className="truncate text-body" title={title}>
        {title}
      </ModalTitle>
      {/* Radix warns without a description; the title alone names the dialog. */}
      <ModalDescription className="sr-only">{title}</ModalDescription>
    </ModalHeader>
  );

  const content = (
    <ModalContent className="px-5 pb-5 pt-0">
      {actions ? (
        <div
          role="toolbar"
          aria-label="Actions"
          className="flex shrink-0 flex-wrap items-center justify-end gap-1 pb-3"
        >
          {actions}
        </div>
      ) : null}
      {children}
    </ModalContent>
  );

  if (isList) {
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        presentation="canvas"
        floating
        width={PREVIEW_LIST_WIDTH}
        showClose={false}
      >
        {header}
        {content}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      presentation={expanded ? 'fullscreen' : 'canvas'}
      size="lg"
      resizable
      floating
      showClose={false}
    >
      {header}
      {content}
    </Modal>
  );
}

/** Download as a frame-bar control: an anchor wearing the icon-pill classes and
    the preview's 44px hit target, for the `headerActions` slot. */
export function PreviewDownloadButton({ href, filename }: { href: string; filename: string }) {
  return (
    <HoverFocusTooltip side="bottom" content="Download">
      <a
        href={href}
        download={filename}
        aria-label={`Download ${filename}`}
        data-preview-action=""
        className={modalIconButtonClassName(PREVIEW_HIT_TARGET)}
      >
        <span aria-hidden className={modalIconPillClassName()}>
          <IconDownload01 className="size-4" />
        </span>
      </a>
    </HoverFocusTooltip>
  );
}
