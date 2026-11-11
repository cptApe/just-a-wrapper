'use client';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { usePointerCoarse } from '@/hooks/use-pointer-coarse';
import {
  readComposerDraft,
  readDraftCursor,
  rememberDraftCursor,
  setComposerText,
} from '../lib/draft-store';
import { LONG_TEXT_ATTACHMENT_CHARS, longTextFile } from '../lib/message-limit';
import { useAutosizeTextarea } from './use-autosize-textarea';
import { useTypeAnywhere } from './use-type-anywhere';

/** The composer's textarea: typing into the draft, keys, paste, and text put in from elsewhere. */
export function useComposerInput({
  draftKey,
  text,
  onSubmit,
  addFiles,
  attachDisabledReason,
}: {
  draftKey: string;
  text: string;
  onSubmit: () => void;
  addFiles: (files: Iterable<File>) => void;
  /** Null when files can be attached. */
  attachDisabledReason: string | null;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Touch keyboards have no Shift+Enter and treat Enter as the newline it looks like; sending
  // is the send button's job there.
  const coarsePointer = usePointerCoarse();
  useAutosizeTextarea(inputRef, text);

  // Put the saved cursor back when a task's draft opens; typing owns it afterwards.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || !readComposerDraft(draftKey).text) return;
    const cursor = readDraftCursor(draftKey);
    el.setSelectionRange(cursor.start, cursor.end);
  }, [draftKey]);

  /** Text written by something other than typing (dictation, a long paste, type-anywhere): cursor to the end. */
  const insertText = useCallback(
    (next: string) => {
      setComposerText(draftKey, next);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.length, next.length);
      });
    },
    [draftKey],
  );

  useTypeAnywhere(
    inputRef,
    useCallback(
      (character) => insertText(readComposerDraft(draftKey).text + character),
      [draftKey, insertText],
    ),
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // On touch, Enter is a newline and the send button sends. On desktop, Enter sends and
    // Shift+Enter is a newline. Never send while an IME is composing (keyCode 229 covers
    // browsers without isComposing): that Enter commits the candidate.
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !coarsePointer &&
      !e.nativeEvent.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === 'Escape') inputRef.current?.blur();
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
    if (attachDisabledReason !== null) {
      if (images.length > 0) toast.error(attachDisabledReason);
      return;
    }
    if (images.length > 0) {
      e.preventDefault();
      addFiles(images);
      return;
    }
    const pasted = e.clipboardData.getData('text/plain');
    if (pasted.trim().length > LONG_TEXT_ATTACHMENT_CHARS) {
      e.preventDefault();
      addFiles([longTextFile(pasted)]);
    }
  }

  return {
    inputRef,
    insertText,
    textarea: {
      value: text,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
        setComposerText(draftKey, e.target.value, {
          start: e.target.selectionStart,
          end: e.target.selectionEnd,
        }),
      onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) =>
        rememberDraftCursor(draftKey, e.currentTarget.selectionStart, e.currentTarget.selectionEnd),
      onKeyDown,
      onPaste,
      // Touch keyboards get a newline-returning Enter; tell the on-screen keyboard so its
      // return key reads "enter", not "send".
      enterKeyHint: coarsePointer ? ('enter' as const) : undefined,
    },
  };
}
