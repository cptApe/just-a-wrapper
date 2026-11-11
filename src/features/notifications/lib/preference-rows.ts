import { PREFERENCE_CATEGORY_META } from '../constants';
import type { PreferenceCategory } from '../types';
import { NOTIFICATION_EVENTS } from './events';

// A switch is shown only when an event behind it can deliver on that channel, so no
// switch on the settings page decides nothing. Every event shows in the feed.
function eventsIn(category: PreferenceCategory) {
  return Object.values(NOTIFICATION_EVENTS).filter((event) => event.preference === category);
}

export function categoryChannels(category: PreferenceCategory): { inApp: boolean; email: boolean } {
  const events = eventsIn(category);
  return {
    inApp: events.length > 0,
    email: events.some((event) => event.email !== undefined),
  };
}

export const PREFERENCE_ROWS = PREFERENCE_CATEGORY_META.map((meta) => ({
  ...meta,
  channels: categoryChannels(meta.category),
}));
