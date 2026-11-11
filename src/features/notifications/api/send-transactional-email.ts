import 'server-only';
import { createHash } from 'node:crypto';
import { Resend } from 'resend';
import { brand } from '@/lib/brand/identity';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { capabilities } from '@/lib/runtime-capabilities';
import type { NotificationEventName } from '../lib/events';

// Better Auth Infrastructure templates are not used: its free plan refuses to send.
const emailCapability = capabilities.email;
type TransactionalPurpose = 'sign-in-code' | 'verify-email' | 'invitation';
export async function sendTransactionalEmail(input: {
  to: string;
  email: { subject: string; html: string; text: string };
  purpose: TransactionalPurpose | NotificationEventName;
  idempotencyKey?: string;
}): Promise<void> {
  switch (emailCapability.kind) {
    case 'off':
      throw new AppError('EXTERNAL_API_FAILED', 'Email delivery is disabled', {
        purpose: input.purpose,
      });
    case 'console':
      // Local sign-in requires the full code or link in the development console.
      process.stdout.write(
        `[email:console] ${input.to} ${input.email.subject}\n${input.email.text}\n`,
      );
      return;
    case 'resend':
      break;
  }
  const resend = new Resend(emailCapability.apiKey);
  const context = {
    purpose: input.purpose,
    recipientHash: createHash('sha256').update(input.to.toLowerCase()).digest('hex'),
  };
  let response;
  try {
    response = await resend.emails.send(
      {
        from: env.EMAIL_FROM ?? `${brand.name} <hello@${brand.domain}>`,
        to: input.to,
        ...input.email,
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    );
  } catch (cause) {
    throw new AppError('EXTERNAL_API_FAILED', `Failed to send ${input.purpose} email`, context, {
      cause,
    });
  }
  if (response.error)
    throw new AppError('EXTERNAL_API_FAILED', `Failed to send ${input.purpose} email`, context, {
      cause: response.error,
    });
  logger().info({ ...context, emailId: response.data.id }, '[email] sent');
}
