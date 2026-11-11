// Shared layout geometry for one members-list row, imported by BOTH the real
// row (members-table.tsx) and its loading twin (members-page-skeleton.tsx) so
// the skeleton can never drift from the loaded row (share
// layout code, never copy class strings). Only layout-affecting classes live
// here — widths, breakpoints, the fixed slots; each site adds its own text/fill
// styling on top. Server-safe (no 'use client'), so the skeleton can import it.

/** The row frame: avatar · identity · badge · last-active · credits · trailing. */
export const MEMBER_ROW = 'flex items-center gap-3 py-4';

/** Leading avatar (36px in this list). */
export const MEMBER_AVATAR = 'size-9 shrink-0';

/** Name + email column — absorbs the row's slack. */
export const MEMBER_IDENTITY = 'min-w-0 flex-1';

/** Role badge column — appears ≥sm. */
export const MEMBER_BADGE_COL = 'hidden shrink-0 sm:inline-flex';

/** Last-active column — fixed 6rem, right-aligned, appears ≥md. */
export const MEMBER_LAST_ACTIVE_COL = 'hidden w-24 shrink-0 justify-end md:flex';

/** Credits column — fixed 5rem, right-aligned, appears ≥lg. */
export const MEMBER_CREDITS_COL = 'hidden w-20 shrink-0 justify-end lg:flex';

/**
 * Trailing action slot — the admin row-actions button. Every row reserves this
 * fixed footprint, 32px or a 44px touch target on phones (an invisible
 * placeholder for members and in the skeleton), so the badge / last-active / credits columns hold one position
 * whether the caller is an admin, a member, or still loading. Omitting it
 * snaps the badge/last-active/credits ~44px when an admin's data lands.
 */
export const MEMBER_TRAILING = 'size-8 shrink-0 max-sm:size-11';

/**
 * Fixed footprint for a pending-invitation row's trailing action cluster
 * (Copy link · Resend · Cancel), right-aligned. The width includes room for
 * each action's busy indicator so a spinner cannot shift the row's right edge.
 */
export const INVITE_ACTIONS_COL = 'w-60 shrink-0 justify-end';
