import {
  type Icon,
  IconBell01,
  IconCoinsHand,
  IconCoinsStacked01,
  IconCreditCard02,
  IconCreditCardCheck,
  IconLinkBroken01,
  IconShare01,
  IconUsers01,
} from '@/components/icons';
import { eventOffersAction, type NotificationEventName } from '../lib/events';
import type { FeedItem } from '../lib/feed-schema';

type FeedItemKind = 'needs_you' | 'fyi';

export interface FeedItemPresentation {
  icon: Icon;
  kind: FeedItemKind;

  // Inline action links to the notification data.link.
  actionLabel?: string;
}

const BY_KIND: Partial<Record<NotificationEventName, FeedItemPresentation>> = {
  'credits.low': { icon: IconCoinsStacked01, kind: 'fyi' },
  'credits.paused': { icon: IconCoinsStacked01, kind: 'needs_you', actionLabel: 'Add credits' },
  'payment.failed': { icon: IconCreditCard02, kind: 'needs_you', actionLabel: 'Update payment' },
  'topup.granted': { icon: IconCoinsHand, kind: 'fyi' },
  'plan.updated': { icon: IconCreditCardCheck, kind: 'fyi' },
  'integration.broken': { icon: IconLinkBroken01, kind: 'needs_you', actionLabel: 'Reconnect' },
  'team.member_joined': { icon: IconUsers01, kind: 'fyi' },
  'team.added_to_workspace': { icon: IconUsers01, kind: 'fyi' },
  'share.received': { icon: IconShare01, kind: 'fyi' },
};

const FALLBACK: FeedItemPresentation = { icon: IconBell01, kind: 'fyi' };

export function presentFeedItem(item: FeedItem): FeedItemPresentation {
  const found = Object.entries(BY_KIND).find(([kind]) => kind === item.kind)?.[1] ?? FALLBACK;
  const mapped = eventOffersAction(item.kind, item.data)
    ? found
    : { ...found, actionLabel: undefined };
  // Event-authored categories take precedence so urgent notices keep their action styling.
  return item.data.category ? { ...mapped, kind: item.data.category } : mapped;
}
