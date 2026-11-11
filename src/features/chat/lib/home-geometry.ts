// The home page's frame geometry, shared between HomeView
// (components/home-view.tsx) and HomeViewSkeleton
// (components/home-view-skeleton.tsx). Server-safe (no 'use client') so the
// route loading boundary renders it without a client bundle. Skeletons import
// these constants — never copy the class strings — so the loading frame cannot
// drift from the real page.

/** Below md, one borderless h-12 top bar aligns the drawer, tier and credits controls.
 * Desktop uses px-4 py-3 without fixed height; MobileNavButton is hidden. */
export const homeTopRowClass =
  'mobile-top-inset flex min-h-12 shrink-0 items-center px-3 md:px-4 md:py-3';

/** The scrollable middle that carries the gravity spacers.
 *  <md the composer pins to the bottom edge: 16px side gutters and a bottom pad
 *  that clears the iOS home indicator. md+ uses the centered px-6, pb-8 frame. */
export const homeScrollAreaClass =
  'flex flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] md:px-6 md:pb-8';

/** Space above the greeting: fills the flex column <md (greeting rides the
 *  centre of the free space above the composer); the 2:3 gravity ratio md+. */
export const homeSpacerTopClass = 'flex-1 md:flex-[2]';

/** Space between the greeting and the composer: <md it grows so the composer
 *  sinks to the bottom edge; md+ it collapses so the greeting sits directly
 *  above the composer as one centred group. */
export const homeSpacerMidClass = 'flex-1 md:hidden';

/** Space below the composer: only md+ (the 2:3 gravity's larger share); <md the
 *  composer is already pinned to the bottom so there is nothing below it. */
export const homeSpacerBottomClass = 'hidden md:block md:flex-[3]';

/** The centered hero column (~768px). Wraps the greeting and the
 *  composer as separate columns so a spacer can sit between them <md. */
export const homeColumnClass = 'mx-auto flex w-full max-w-[768px] flex-col';

/** The greeting line above the composer. */
export const homeGreetingClass = 'mb-7 text-center text-title-page';
