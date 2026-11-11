import 'server-only';
import { sendTransactionalEmail } from '@/features/notifications/api/send-transactional-email';
import { invitationEmail } from '@/features/notifications/lib/transactional-templates';
import { readContactDetails } from '@/lib/brand/contact';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';

/** Days an invitation stays valid — Better Auth's org-plugin default (48h). */
const INVITATION_EXPIRES_DAYS = 2;

function buildInviteLink(invitationId: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/invite/${invitationId}`;
}

export async function sendInvitationEmail(
  data: {
    id: string;
    email: string;
    role: string;
    organizationName: string;
    inviterName: string;
    inviterEmail: string;
  },
  invitation: { id: string },
): Promise<boolean> {
  // Better Auth returns this same object for creation and resend. Default to
  // false even if a future configuration runs the hook in the background.
  Object.assign(invitation, { emailSent: false });
  if (capabilities.email.kind === 'off') return false;
  try {
    const inviteLink = buildInviteLink(data.id);
    await sendTransactionalEmail({
      to: data.email,
      purpose: 'invitation',
      email: invitationEmail({
        inviteLink,
        inviterName: data.inviterName,
        inviterEmail: data.inviterEmail,
        organizationName: data.organizationName,
        expiresDays: INVITATION_EXPIRES_DAYS,
        contact: await readContactDetails(),
      }),
    });
    Object.assign(invitation, { emailSent: capabilities.email.kind === 'resend' });
    return capabilities.email.kind === 'resend';
  } catch (cause) {
    captureException(
      cause instanceof AppError
        ? cause
        : new AppError(
            'EXTERNAL_API_FAILED',
            'Failed to send invitation email',
            { invitationId: data.id },
            { cause },
          ),
      { op: 'workspace.invitation-email', invitationId: data.id },
    );
    return false;
  }
}
