'use client';
import { useReducer } from 'react';
import { IconCheck } from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import {
  ListRow,
  ListRowContent,
  ListRowIcon,
  ListRowMeta,
  ListRowTitle,
} from '@/components/ui/list-row';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  formatNotificationDate,
  groupedNotificationTitle,
  notificationBody,
  notificationTitle,
} from '../lib/feed-display';
import type { FeedItem } from '../lib/feed-schema';
import { reduceTouchMenu } from '../lib/touch-menu-machine';
import { presentFeedItem } from './notification-presentation';

// The row corner: the large token plus one pixel. Inside a 24px popover with
// an 8px inset the math says 16px, but the 1px inset ring makes the eye read
// the line, not the box, and 17px is what looks concentric next to the popover corner.
const ROW_RADIUS_STYLE = { borderRadius: 'calc(var(--radius-lg) + 1px)' } as const;

export function FeedRow({
  item,
  groupedItems,
  onOpen,
  onMarkRead,
  onAction,
}: {
  item: FeedItem;
  groupedItems: FeedItem[];
  onOpen: (item: FeedItem, groupedItems: FeedItem[]) => void;
  onMarkRead: (item: FeedItem | FeedItem[]) => void;
  onAction: (item: FeedItem, groupedItems: FeedItem[]) => void;
}) {
  const { timeZone } = useDisplayFormat();
  const [menu, dispatchMenu] = useReducer(reduceTouchMenu, { phase: 'normal' });
  const touchMenuOpen = menu.phase === 'menu';
  const baseTitle = notificationTitle(item);
  const title = groupedNotificationTitle(baseTitle, groupedItems.length, item.createdAt, timeZone);
  const body = notificationBody(item, baseTitle);
  const unreadItems = groupedItems.filter((groupedItem) => groupedItem.readAt === null);
  const unread = unreadItems.length > 0;
  const { icon: TypeIcon, kind, actionLabel } = presentFeedItem(item);
  const needsYou = kind === 'needs_you';

  const handleOpen = () => {
    if (menu.phase !== 'normal') {
      dispatchMenu('open');
      return;
    }
    onOpen(item, groupedItems);
  };

  const markUnreadItems = () => {
    onMarkRead(unreadItems);
    dispatchMenu('read');
  };

  return (
    <li
      className="group relative"
      data-kind={kind}
      onContextMenu={(event) => {
        if (!unread || !window.matchMedia('(pointer: coarse)').matches) return;
        event.preventDefault();
        dispatchMenu('context');
      }}
    >
      {/* The row's open target: an overlay button UNDER the row's interactive
          children (inline action, mark-read) — a row can't be one big <button>
          once it contains buttons of its own (invalid nesting). */}
      <button
        type="button"
        aria-label={`Open notification: ${title}`}
        onClick={handleOpen}
        className={cn(
          'absolute inset-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        )}
        style={ROW_RADIUS_STYLE}
      />
      {/* Unread is a row-level state: a soft fill and a hairline border, in
          the popover's dark glass and the overlay alike. No dot: a floating
          dot inside the Unread tab carries no information. */}
      <ListRow
        className={cn(
          'pointer-events-none relative items-start px-2.5 pr-10',
          unread
            ? 'bg-alpha-6 ring-1 ring-inset ring-alpha-8 group-hover:bg-alpha-8'
            : 'group-hover:bg-alpha-6',
        )}
        style={ROW_RADIUS_STYLE}
      >
        <ListRowIcon className={cn('rounded-sm', needsYou && 'bg-primary text-primary-foreground')}>
          <TypeIcon />
        </ListRowIcon>
        <ListRowContent>
          <ListRowTitle>{title}</ListRowTitle>
          {body ? (
            <ListRowMeta className="line-clamp-1 whitespace-normal">{body}</ListRowMeta>
          ) : null}
          <span className="text-meta font-medium text-foreground-tertiary">
            {formatNotificationDate(item.createdAt, timeZone)}
          </span>
          {needsYou && actionLabel ? (
            <span className="pt-1.5">
              <Button
                type="button"
                variant="primary"
                size="xs"
                data-testid="notification-inline-action"
                className="pointer-events-auto relative"
                onClick={() => onAction(item, groupedItems)}
              >
                {actionLabel}
              </Button>
            </span>
          ) : null}
        </ListRowContent>
      </ListRow>
      {unread ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Mark as read"
              onClick={markUnreadItems}
              className={cn(
                'absolute right-2 top-2 text-muted-foreground opacity-0',
                'pointer-coarse:hidden',
                'focus-visible:opacity-100',
                'group-hover:opacity-100 group-focus-within:opacity-100',
              )}
            >
              <IconCheck className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Mark as read</TooltipContent>
        </Tooltip>
      ) : null}
      {touchMenuOpen && unread ? (
        <div
          role="group"
          aria-label="Notification actions"
          className="absolute right-2 top-1.5 z-dropdown hidden rounded-lg bg-popover p-1 shadow-glass pointer-coarse:block"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            autoFocus
            onClick={markUnreadItems}
            onBlur={() => dispatchMenu('blur')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') dispatchMenu('blur');
            }}
          >
            <IconCheck className="size-4" />
            Mark as read
          </Button>
        </div>
      ) : null}
    </li>
  );
}
