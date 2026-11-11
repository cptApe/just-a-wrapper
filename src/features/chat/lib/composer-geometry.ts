// The composer card's geometry, shared between the real composer
// (components/composer.tsx) and its skeleton (components/composer-skeleton.tsx).
// This file is deliberately server-safe (no 'use client'): route loading
// skeletons import from here without pulling the interactive composer into a
// client boundary. Skeletons must import these constants — never copy the
// class strings — so the loading card cannot drift from the real one.

/** The card frame at rest: shape, surface, hairline. The
 *  surface is `--card` (solid, opaque) so the theme editor's Card control
 *  restyles the chat input and the card stays distinct from the page. */
export const composerCardClass =
  'relative isolate flex w-full flex-col overflow-hidden rounded-xl border bg-card';

/** The inner stack: input region over the action row. */
export const composerCardInnerClass = 'flex flex-col gap-2 px-4 pb-3 pt-3.5';

/** The chat-variant wrapper: pinned under the thread, centered 3xl column. */
export const composerChatWrapClass = 'shrink-0 px-4 pt-2';
export const composerChatColumnClass = 'mx-auto w-full max-w-3xl';

/** Carries bottom safe-area clearance below the Task composer. The zone is
 *  shared with the ComposerMetaRow (plan label + disclaimer, ~20px incl. its
 *  own top gap), so the pad itself is just the 6px/8px remainder — together
 *  they keep the card's ~24px/28px breathing room from the viewport edge —
 *  and never less than the device safe-area inset. Every user of this class
 *  must render the meta row after the composer, or the clearance collapses. */
export const composerBottomSafeAreaClass =
  'shrink-0 pb-[max(env(safe-area-inset-bottom),0.375rem)] sm:pb-[max(env(safe-area-inset-bottom),0.5rem)]';
