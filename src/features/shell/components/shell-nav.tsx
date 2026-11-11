'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItemClasses, railItemClasses } from '@/components/layouts/nav-item-classes';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
// Leaf import past the chat barrel on purpose: the barrel pulls the whole chat
// surface (ChatView/HomeView) into the shell chunk.
import { requestHomeNewTask } from '@/features/chat/lib/composer-focus';
// Same precedent for search: the barrel is its server-API surface.
import { RailSearchNavItem, SearchNavItem } from '@/features/search/components/search-nav-item';
import { type NavItem, newTaskNav, primaryNav } from '../lib/nav';

// The primary nav rendered inside both the desktop sidebar and the mobile
// sheet. New task renders separately so it stays above the
// shared scroll container; Notifications mounts via the `trailing` slot (a
// popover anchor, not a route). `onNavigate` lets the mobile sheet close on tap.

function RailNavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = item.match(pathname);
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          data-rail-item
          aria-current={active ? 'page' : undefined}
          aria-label={item.label}
          className={railItemClasses(active)}
        >
          <Icon className="size-5 shrink-0" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = item.match(pathname);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={navItemClasses(active)}
    >
      <Icon className="size-5 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/** The New task entry. When the Home page is mounted (on /app, or still
    mounted behind a task it just opened) it resets itself and takes focus
    instead of a navigation that would not re-render it. Otherwise the link
    navigates to /app as usual. */
function useNewTaskClick(onNavigate?: () => void) {
  return (e: React.MouseEvent) => {
    onNavigate?.();
    if (requestHomeNewTask()) e.preventDefault();
  };
}

/** The New task entry (expanded). The shell renders it as a fixed block above
    the scroll content, so it never scrolls with the nav + history. */
export function NewTaskLink({ onNavigate }: { onNavigate?: () => void }) {
  const onClick = useNewTaskClick(onNavigate);
  const Icon = newTaskNav.icon;
  return (
    <Link href={newTaskNav.href} onClick={onClick} className={navItemClasses(false)}>
      <Icon className="size-5 shrink-0" />
      <span className="truncate">{newTaskNav.label}</span>
    </Link>
  );
}

/** The New task entry in collapsed-rail form. */
export function RailNewTaskLink() {
  const onClick = useNewTaskClick();
  const Icon = newTaskNav.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={newTaskNav.href}
          onClick={onClick}
          data-rail-item
          aria-label={newTaskNav.label}
          className={railItemClasses(false)}
        >
          <Icon className="size-5 shrink-0" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{newTaskNav.label}</TooltipContent>
    </Tooltip>
  );
}

/** The collapsed rail's nav column: primary nav as icon items, then the
    trailing slot (the Notifications popover anchor) and the Search action
    below it (Search opens the ⌘K command menu). */
export function RailNav({ trailing }: { trailing?: React.ReactNode }) {
  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-0.5">
        {primaryNav.map((item) => (
          <li key={item.href}>
            <RailNavLink item={item} />
          </li>
        ))}
        {trailing ? <li>{trailing}</li> : null}
        <li>
          <RailSearchNavItem className={railItemClasses(false)} />
        </li>
      </ul>
    </nav>
  );
}

export function ShellNav({
  onNavigate,
  trailing,
}: {
  onNavigate?: () => void;
  /** Rendered as the last nav entry (the Notifications popover anchor). */
  trailing?: React.ReactNode;
}) {
  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-0.5">
        {primaryNav.map((item) => (
          <li key={item.href}>
            <NavLink item={item} onNavigate={onNavigate} />
          </li>
        ))}
        {trailing ? <li>{trailing}</li> : null}
        {/* Search sits directly below Notifications: an action row that opens
            the ⌘K command menu (the host mounts in the /app layout). */}
        <li>
          <SearchNavItem className={navItemClasses(false)} onOpen={onNavigate} />
        </li>
      </ul>
    </nav>
  );
}
