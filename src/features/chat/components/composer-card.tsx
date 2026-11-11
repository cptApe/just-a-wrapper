'use client';
import type { ReactNode, RefObject } from 'react';
import { IconPaperclip } from '@/components/icons';
import { Form } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import type { useComposerDrop } from '../hooks/use-composer-drop';
import type { PendingAttachment } from '../lib/attachments';
import type { ComposerDraft, PickKind } from '../lib/composer-draft';
import { composerCardClass, composerCardInnerClass } from '../lib/composer-geometry';
import { ComposerAttachments } from './composer-attachments';

export function ComposerCard({
  draft,
  onRemoveAttachment,
  onRetryAttachment,
  onUnpick,
  onSubmit,
  inputRef,
  voiceActive,
  dragProps,
  showDropOverlay,
  children,
}: {
  draft: ComposerDraft;
  onRemoveAttachment: (id: string) => void;
  onRetryAttachment: (attachment: PendingAttachment) => void;
  onUnpick: (kind: PickKind, key: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  voiceActive: boolean;
  dragProps: ReturnType<typeof useComposerDrop>['props'];
  showDropOverlay: boolean;
  /** The input and the toolbar. */
  children: ReactNode;
}) {
  const hasText = draft.text.trim().length > 0;
  const hasAttachments =
    draft.attachments.length > 0 || draft.library.length > 0 || draft.folders.length > 0;
  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      // Focus the textarea when the card's padding is pressed, WITHOUT the
      // press first blurring it: a bare click on non-focusable padding moves
      // focus to <body> on mousedown and back on click, which flickers the
      // :focus-within border for a frame. Guarding mousedown keeps focus put.
      // Presses on the textarea or an inner control fall through untouched.
      onMouseDown={(e) => {
        if (voiceActive) return;
        if (
          e.target instanceof Element &&
          e.target.closest('button, a, input, textarea, [role="button"]')
        ) {
          return;
        }
        e.preventDefault();
        inputRef.current?.focus();
      }}
      onClick={() => {
        if (!voiceActive) inputRef.current?.focus();
      }}
      {...dragProps}
      data-testid="composer"
      className={cn(
        // Card geometry lives in lib/composer-geometry.ts, shared with
        // ComposerSkeleton so the loading card cannot drift from this one.
        composerCardClass,
        'cursor-text',
        // The composer's sanctioned hairline — strengthens with
        // content, and with focus via CSS :focus-within (no React state, so no
        // re-render on focus/blur and no flicker as focus moves between the
        // textarea and the inner buttons). The one allowed in-page shadow
        // (a near-invisible ambient) rides in the shared card class.
        'transition-[border-color] duration-150 ease-[cubic-bezier(0,0,0.2,1)]',
        hasText || hasAttachments || showDropOverlay
          ? 'border-alpha-12'
          : 'border-alpha-8 focus-within:border-alpha-12',
      )}
    >
      {/* The attached-files row stays put during dictation too — the wave only
          swaps the textarea, so nothing above or below it moves (zero shift). */}
      <ComposerAttachments
        attachments={draft.attachments}
        onRemove={onRemoveAttachment}
        onRetry={(id) => {
          const pending = draft.attachments.find((item) => item.id === id);
          if (pending?.status === 'failed') onRetryAttachment(pending);
        }}
        libraryFiles={draft.library}
        onRemoveLibraryFile={(id) => onUnpick('library', id)}
        libraryFolders={draft.folders}
        onRemoveLibraryFolder={(path) => onUnpick('folders', path)}
        skills={draft.skills}
        onRemoveSkill={(id) => onUnpick('skills', id)}
      />

      <div className={composerCardInnerClass}>
        {/* Stable-height input region: the textarea (1 row) and the voice wave
            both settle to min-h-9, so entering/leaving dictation swaps ONLY this
            area — the action row below stays put and the card never shifts
            (spec: "the textarea area becomes the audio wave … same footprint"). */}
        {children}
      </div>

      {showDropOverlay ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-card/95"
          data-testid="composer-drop-overlay"
        >
          <span className="flex items-center gap-2 text-meta text-muted-foreground">
            <IconPaperclip className="size-4" />
            Drop files to attach
          </span>
        </div>
      ) : null}
    </Form>
  );
}
