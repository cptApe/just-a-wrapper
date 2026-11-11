import {
  emailOTPClient,
  inferAdditionalFields,
  organizationClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { auth } from '@/lib/auth';

// Browser client — our forms call this.
//   1. request OTP:    authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
//   2. verify+sign-in: authClient.signIn.emailOtp({ email, otp })
//   Google:            authClient.signIn.social({ provider: 'google', callbackURL: '/app' })
//
// inferAdditionalFields<typeof auth> types the custom user fields (timezone,
// timeFormat) on the client session so reads off session.user are typed. Writes
// go through our server actions (src/features/preferences), not authClient.
export const authClient = createAuthClient({
  plugins: [emailOTPClient(), organizationClient(), inferAdditionalFields<typeof auth>()],
});
