import { z } from 'zod';
import type { ContactDetails } from '@/lib/brand/contact';
import { brand } from '@/lib/brand/identity';
import { AppError } from '@/lib/errors';
import { emailLayout } from './email-layout';
import { eventOffersAction, type NotificationEventName, requireEventDef } from './events';

// Why the email went out, stored on the notification so a retry says the same thing.
// 'schedule' is a schedule set to email whether or not the person is away.
const EMAIL_REASONS = ['away', 'schedule'] as const;
export type EmailReason = (typeof EMAIL_REASONS)[number];

const FOOTER: Record<EmailReason, string> = {
  away: `You get these updates when you are away from ${brand.name}.`,
  schedule: 'You get this email because the schedule is set to email you.',
};

const contentSchema = z.object({
  title: z.string().optional(),
  taskTitle: z.string().optional(),
  body: z.string().optional(),
  link: z.string(),
  emailReason: z.enum(EMAIL_REASONS).optional(),
  pauseReason: z.string().optional(),
});

export function emailReasonOf(payload: unknown): EmailReason {
  return contentSchema.pick({ emailReason: true }).parse(payload).emailReason ?? 'away';
}

export function notificationEmail(
  kind: NotificationEventName,
  payload: unknown,
  contact: ContactDetails,
) {
  const content = contentSchema.parse(payload);
  const copy = requireEventDef(kind).email;
  if (!copy) throw new AppError('UNEXPECTED', 'Notification kind has no email', { kind });
  const heading = content.taskTitle ?? content.title ?? copy.subject;
  return {
    subject: heading,
    ...emailLayout({
      heading,
      // The feed item shows the emitter's body; the email gives the same reason.
      lines: [content.body ?? copy.body],
      button: eventOffersAction(kind, content)
        ? { label: copy.buttonLabel, url: new URL(content.link, brand.url).href }
        : undefined,
      footerReason: FOOTER[emailReasonOf(payload)],
      supportEmail: contact.supportEmail,
    }),
  };
}
