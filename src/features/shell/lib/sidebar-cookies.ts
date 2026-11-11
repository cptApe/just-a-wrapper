// Sidebar UI-state cookies — not localStorage — so the server layout reads them
// and the first SSR paint already matches (no hydration flash). Plain UI
// preferences, not auth state, so client-side non-httpOnly writes are correct.

export const SIDEBAR_COLLAPSED_COOKIE = 'sidebar_collapsed';
// "Recents" history section open-state (name kept for cookie stability).
export const SIDEBAR_TASKS_OPEN_COOKIE = 'sidebar_tasks_open';
// "Pinned" history section open-state.
export const SIDEBAR_PINNED_OPEN_COOKIE = 'sidebar_pinned_open';
// Persist whether the Team history section is open.
export const SIDEBAR_TEAM_OPEN_COOKIE = 'sidebar_team_open';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Client-side cookie write for a sidebar preference ('1' | '0'). */
export function writeSidebarCookie(name: string, value: boolean): void {
  document.cookie = `${name}=${value ? '1' : '0'}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}

/** Client-side cookie read for a sidebar preference; null when unset (or on the server). */
export function readSidebarCookie(name: string): boolean | null {
  if (typeof document === 'undefined') return null;
  const entry = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  if (!entry) return null;
  return entry.slice(name.length + 1) === '1';
}
