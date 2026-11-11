import { z } from 'zod';

// Better Auth's invite response carries the app's emailSent flag from sendInvitationEmail.
const invitationSentSchema = z.object({ emailSent: z.literal(true) });

export function invitationEmailWasSent(response: unknown): boolean {
  return invitationSentSchema.safeParse(response).success;
}
