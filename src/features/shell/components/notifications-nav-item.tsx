'use client';

import { IconBell01 } from '@/components/icons';
import { navItemClasses, railItemClasses } from '@/components/layouts/nav-item-classes';
import { CountBadge } from '@/components/ui/count-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NotificationsBell } from '@/features/notifications/components/notifications-bell';
import { cn } from '@/lib/utils';

export function NotificationsNavItem({ side }: { side: 'right' | 'bottom' }) {
  return (
    <NotificationsBell
      side={side}
      align="start"
      sideOffset={12}
      renderTrigger={({ unread }) => (
        <button
          type="button"
          data-testid="sidebar-notifications"
          aria-label={unread > 0 ? `Notifications (${unread} new)` : 'Notifications'}
          className={navItemClasses(false)}
        >
          <IconBell01 className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Notifications</span>
          {unread > 0 ? <CountBadge count={unread} data-testid="notifications-badge" /> : null}
        </button>
      )}
    />
  );
}

export function NotificationsRailItem() {
  // Tooltip root here, TooltipTrigger nested in renderTrigger: the bell button
  // is both the Popover trigger (asChild, inside NotificationsBell) and the
  // Tooltip trigger, so the rail item gets the same hover label as the others.
  return (
    <Tooltip>
      <NotificationsBell
        side="right"
        align="start"
        sideOffset={12}
        renderTrigger={({ unread }) => (
          <TooltipTrigger asChild>
            <button
              type="button"
              data-rail-item
              data-testid="sidebar-notifications"
              aria-label={unread > 0 ? `Notifications (${unread} new)` : 'Notifications'}
              className={cn(railItemClasses(false), 'relative')}
            >
              <IconBell01 className="size-5 shrink-0" />
              {unread > 0 ? (
                <CountBadge
                  count={unread}
                  data-testid="notifications-badge"
                  className="absolute right-0.5 top-0.5"
                />
              ) : null}
            </button>
          </TooltipTrigger>
        )}
      />
      <TooltipContent side="right">Notifications</TooltipContent>
    </Tooltip>
  );
}
