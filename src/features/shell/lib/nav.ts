import { type Icon, IconBookOpen01, IconClock, IconGrid01, IconPlus } from '@/components/icons';

// Static nav config for the app shell sidebar (order: New task →
// Scheduled → Tools → Library; Notifications renders after these as a popover
// anchor, not a route). Plain client-safe module (no RSC boundary), so the
// `match` predicates travel fine — they decide active state from the current
// pathname. Adding a product surface is a one-line edit here.
export type NavItem = {
  label: string;
  href: string;
  icon: Icon;
  // True when the current pathname should render this item active.
  match: (pathname: string) => boolean;
};

// New task is an action, not a destination, and never receives an active pill.
// It stays sticky inside the sidebar scroll container.
export const newTaskNav: NavItem = {
  label: 'New task',
  href: '/app',
  icon: IconPlus,
  match: () => false,
};

export const primaryNav: NavItem[] = [
  {
    label: 'Scheduled',
    href: '/app/scheduled',
    icon: IconClock,
    match: (p) => p === '/app/scheduled' || p.startsWith('/app/scheduled/'),
  },
  {
    label: 'Tools',
    href: '/app/tools',
    icon: IconGrid01,
    match: (p) => p === '/app/tools' || p.startsWith('/app/tools/'),
  },
  {
    label: 'Library',
    href: '/app/library',
    icon: IconBookOpen01,
    match: (p) => p === '/app/library' || p.startsWith('/app/library/'),
  },
];

/** The phone top bar's page name: the label of the nav item that is active
    for this pathname, so the bar and the sidebar always agree. Null when no
    nav destination owns the route. */
export function navPageTitle(pathname: string): string | null {
  return primaryNav.find((item) => item.match(pathname))?.label ?? null;
}
