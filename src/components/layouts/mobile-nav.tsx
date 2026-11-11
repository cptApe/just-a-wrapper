'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { IconMenu05 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CountBadge } from '@/components/ui/count-badge';
import { AppError } from '@/lib/errors';
import { cn } from '@/lib/utils';

// The mobile top bar is ONE bar per page (no stacked shell-bar + page-header on
// <md). The shell owns the drawer state and the live unread count; each surface
// that renders the single bar — the shell chrome, Home, Task — drops in the same
// <MobileNavButton/> for a pixel- and behavior-identical drawer trigger. This
// context carries just the two primitives the button needs (open + unread), so
// there is no render-phase node passing, only plain values.

type MobileNavApi = {
  /** Opens the navigation drawer (the shell's mobile Sheet). */
  openNav: () => void;
  /** Live unread notification count for the trigger's badge. */
  unread: number;
};

const MobileNavContext = createContext<MobileNavApi | null>(null);

export function MobileNavProvider({
  value,
  children,
}: {
  value: MobileNavApi;
  children: ReactNode;
}) {
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

function useMobileNav(): MobileNavApi {
  const ctx = useContext(MobileNavContext);
  if (!ctx)
    throw new AppError('UNEXPECTED', 'MobileNavButton must be rendered inside <AppShell>', {
      component: 'MobileNavButton',
    });
  return ctx;
}

/** The mobile drawer trigger: hamburger + live unread badge. size-11 keeps the
 *  tap target ≥44px while the glyph stays a clean size-5 2-line menu. The badge
 *  is absolutely positioned so a change in unread count never shifts the bar. */
export function MobileNavButton({ className }: { className?: string }) {
  const { openNav, unread } = useMobileNav();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={openNav}
      aria-label={unread > 0 ? `Open navigation (${unread} unread)` : 'Open navigation'}
      className={cn('relative size-11', className)}
    >
      <IconMenu05 className="size-5" />
      {unread > 0 ? (
        <CountBadge
          count={unread}
          data-testid="notifications-badge"
          className="absolute right-1 top-1"
        />
      ) : null}
    </Button>
  );
}
