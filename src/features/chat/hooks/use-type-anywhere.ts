'use client';

import { type RefObject, useEffect } from 'react';
import { usePointerCoarse } from '@/hooks/use-pointer-coarse';

// Type anywhere and the composer catches it: a
// printable keypress anywhere on home or chat focuses the composer and feeds it
// the character. Strictly scoped so it never steals input:
//   • coarse-pointer (touch) devices are opted out entirely — there's no
//     hardware keyboard to catch, and force-focusing the composer would pop the
//     on-screen keyboard on a stray key event;
//   • printable single characters only — no modifiers, no nav/function keys;
//   • never when another input/textarea/select/contenteditable has focus;
//   • never while an overlay (dialog, menu, popover) is open — those own the
//     keyboard.
// The keydown's default would land on the previous focus target, so the hook
// preventDefaults and hands the character to the caller to append.

export function useTypeAnywhere(
  ref: RefObject<HTMLTextAreaElement | null>,
  onCharacter: (character: string) => void,
): void {
  const isCoarse = usePointerCoarse();
  useEffect(() => {
    // No hardware keyboard on touch — never intercept keys or steal focus there.
    if (isCoarse) return;
    const handler = (e: KeyboardEvent) => {
      const el = ref.current;
      if (!el || el.readOnly || el.disabled) return;
      if (document.activeElement === el) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;

      if (!(e.target instanceof HTMLElement)) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.target.isContentEditable) return;

      // Radix overlays (dialogs, dropdowns, popovers) own the keyboard while open.
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [data-radix-popper-content-wrapper]',
        )
      ) {
        return;
      }

      e.preventDefault();
      el.focus();
      onCharacter(e.key);
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [ref, onCharacter, isCoarse]);
}
