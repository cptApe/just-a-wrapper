import { formatShortDate, zonedDayKey } from '@/lib/format/format-date';
import { formatRelativeTime } from '@/lib/format/format-relative';
import type { FeedItem } from './feed-schema';

export type FeedItemGroup = {
  key: string;
  item: FeedItem;
  items: FeedItem[];
};

// Rows of one kind on one day in the reader's zone collapse into one group.
export function groupFeedItems(items: FeedItem[], timeZone: string): FeedItemGroup[] {
  const groups: FeedItemGroup[] = [];
  const groupsByKey = new Map<string, FeedItemGroup>();

  for (const item of items) {
    const key = `${item.kind}:${zonedDayKey(item.createdAt, timeZone) ?? item.createdAt}`;
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }

    const group = { key, item, items: [item] };
    groupsByKey.set(key, group);
    groups.push(group);
  }

  return groups;
}

export function notificationBody(item: FeedItem, title: string): string | undefined {
  const dataBody = textData(item, 'body');
  const body = plainText(dataBody);
  if (!body) return undefined;

  const normalizedTitle = plainText(title);
  if (
    !normalizedTitle ||
    !body.toLocaleLowerCase().startsWith(normalizedTitle.toLocaleLowerCase())
  ) {
    return body;
  }

  const remainder = body
    .slice(normalizedTitle.length)
    .replace(/^[\s\p{P}\p{S}]+/u, '')
    .trim();
  return remainder || undefined;
}

export function notificationTitle(item: FeedItem): string {
  return textData(item, 'title') ?? 'Notification';
}

export function groupedNotificationTitle(
  title: string,
  count: number,
  insertedAt: string,
  timeZone: string,
): string {
  if (count === 1) return title;
  return `${title}, ${count} times on ${formatShortDate(insertedAt, timeZone)}`;
}

export function formatNotificationDate(
  iso: string,
  timeZone: string,
  now: Date = new Date(),
): string {
  return formatRelativeTime(iso, { now, timeZone });
}

function textData(item: FeedItem, key: string): string | undefined {
  const value = item.data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function plainText(value: string | undefined): string | undefined {
  const text = value
    ?.replace(/<\/(?:p|div|li|h[1-6])>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/(?:\*\*|__|`)/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}
