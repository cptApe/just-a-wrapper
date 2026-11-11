import { AppError } from '@/lib/errors';
import type { PreferenceCategory } from '../types';

export type NotificationEventName =
  | 'task.completed'
  | 'task.failed'
  | 'task.needs_input'
  | 'topup.granted'
  | 'credits.low'
  | 'credits.paused'
  | 'payment.failed'
  | 'plan.updated'
  | 'integration.broken'
  | 'team.member_joined'
  | 'team.added_to_workspace'
  | 'share.received';

type NotificationCategory = 'needs_you' | 'fyi';
export interface NotificationPayload {
  organizationId: string;
  idempotencyKey?: string;

  // Omitted means all current members; private task emitters explicitly pass only the creator.
  recipientUserIds?: string[];

  // Schedules explicitly choose channels; ordinary notices use category preferences.
  channels?: { inApp: boolean; email: 'force' | 'preference' | 'off' };
  data?: Record<string, unknown>;
}

export interface NotificationEventDef {
  // The fallback email copy; a payload's own `body` replaces `body` so the email says what the feed says.
  email?: { subject: string; body: string; buttonLabel: string };
  category: NotificationCategory;
  // The Settings → Notifications row whose switches gate this event, for the feed and for email.
  preference: PreferenceCategory;
  link: (data: Record<string, unknown>) => string;
  /** False when the notice's button cannot help this reader. Unset means the button always shows. */
  offersAction?: (data: Record<string, unknown>) => boolean;
}
// Warn on threshold crossing; the occurrence key prevents repeated small-decrement notices.
export const LOW_CREDITS_THRESHOLD = 4000;
// Requested task email and urgent notices send only after ten minutes without active app use.
export const AWAY_THRESHOLD_MINUTES = 10;

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function taskLink(d: Record<string, unknown>): string {
  return str(d, 'sessionId') ? `/app/task/${str(d, 'sessionId')}` : '/app/scheduled';
}
export const NOTIFICATION_EVENTS: Record<NotificationEventName, NotificationEventDef> = {
  'task.completed': {
    email: {
      subject: 'Task completed',
      body: 'The task finished.',
      buttonLabel: 'See the result',
    },
    category: 'fyi',
    preference: 'task_alerts',
    link: taskLink,
  },
  'task.failed': {
    email: {
      subject: 'Task failed',
      body: 'Stopped on an error.',
      buttonLabel: 'See what happened',
    },
    category: 'needs_you',
    preference: 'task_alerts',
    link: taskLink,
  },
  'task.needs_input': {
    email: {
      subject: 'A task needs your input',
      body: 'Waiting for your answer.',
      buttonLabel: 'Answer',
    },
    category: 'needs_you',
    preference: 'task_alerts',
    link: taskLink,
  },
  'topup.granted': {
    category: 'fyi',
    preference: 'account_billing',
    link: () => '/app/settings/billing',
  },
  'credits.low': {
    category: 'fyi',
    preference: 'account_billing',
    link: () => '/app/settings/billing',
  },
  'credits.paused': {
    email: {
      subject: 'Your agent is paused',
      body: 'You ran out of credits. Add credits to resume your session.',
      buttonLabel: 'Add credits',
    },
    category: 'needs_you',
    preference: 'account_billing',
    link: () => '/app/settings/billing#topup',
    // Credits cannot lift a member's own credit limit, so that pause offers no button.
    offersAction: (d) => d.pauseReason !== 'member_limit',
  },
  'payment.failed': {
    email: {
      subject: 'Payment failed',
      body: 'Your payment did not go through. Update your payment method to keep your plan.',
      buttonLabel: 'Update payment method',
    },
    category: 'needs_you',
    preference: 'account_billing',
    link: () => '/app/settings/billing',
  },
  'plan.updated': {
    category: 'fyi',
    preference: 'account_billing',
    link: () => '/app/settings/billing',
  },
  'integration.broken': {
    email: {
      subject: 'An app needs reconnecting',
      body: 'Your app connection stopped working. Reconnect it so your agent can use it.',
      buttonLabel: 'Reconnect app',
    },
    category: 'needs_you',
    preference: 'connections',
    link: (d) => (str(d, 'slug') ? `/app/tools#app/${str(d, 'slug')}` : '/app/tools'),
  },
  'team.member_joined': {
    category: 'fyi',
    preference: 'team_sharing',
    link: () => '/app/settings/members',
  },
  'team.added_to_workspace': {
    category: 'fyi',
    preference: 'team_sharing',
    link: () => '/app',
  },
  'share.received': {
    category: 'fyi',
    preference: 'team_sharing',
    link: (d) => str(d, 'link') ?? '/app/library',
  },
};
export function hasEventMapping(name: string): name is NotificationEventName {
  return Object.hasOwn(NOTIFICATION_EVENTS, name);
}
export function requireEventDef(name: string): NotificationEventDef {
  if (!hasEventMapping(name)) {
    throw new AppError('UNEXPECTED', `no notification mapping for event "${name}"`, {
      event: name,
    });
  }
  return NOTIFICATION_EVENTS[name];
}
export function linkForEvent(
  name: NotificationEventName,
  data: Record<string, unknown> = {},
): string {
  return NOTIFICATION_EVENTS[name].link(data);
}
/** Whether the feed row and the email of this notice show their button. */
export function eventOffersAction(name: string, data: Record<string, unknown> = {}): boolean {
  if (!hasEventMapping(name)) return false;
  return NOTIFICATION_EVENTS[name].offersAction?.(data) ?? true;
}
// Away is sampled at emit time; later absence is not rechecked.
export function isAway(lastActiveAt: Date | null, now: Date): boolean {
  if (!lastActiveAt) return true;
  const elapsedMs = now.getTime() - lastActiveAt.getTime();
  return elapsedMs >= AWAY_THRESHOLD_MINUTES * 60_000;
}
