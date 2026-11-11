import { existsSync, readFileSync } from 'node:fs';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP, organization } from 'better-auth/plugins';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { workspace, workspaceNotDeleted } from '@/db/schema';
import { limitRefusal } from '@/features/billing/api/plan-limits';
import { membersExceeded, membersMessage } from '@/features/billing/lib/plan-gates';
import { sendTransactionalEmail } from '@/features/notifications/api/send-transactional-email';
import {
  signInCodeEmail,
  verifyEmailChangeEmail,
} from '@/features/notifications/lib/transactional-templates';
import { scheduleCreatorTaskSync } from '@/features/tasks/api/sync-creator-tasks';
import { sendInvitationEmail } from '@/features/workspaces/api/invitation-email';
import { cancelExpiredInvitations } from '@/features/workspaces/api/invitation-transitions';
import { countWorkspaceSeats } from '@/features/workspaces/api/members';
import { captureEvent } from '@/lib/analytics';
import { readContactDetails } from '@/lib/brand/contact';
import { captureDevOtp } from '@/lib/dev-auth';
import { env } from '@/lib/env';
import { logBetterAuth, logger } from '@/lib/logger';
import { capabilities } from '@/lib/runtime-capabilities';
import { workspaceIdForOrganization } from '@/lib/workspace-identity';

// The dev cookie-prefix port, resolved once at config init. `.dev-port` (written
// by scripts/resolve-dev-port.mjs, the source of truth for the actually-bound
// port) wins; the app URL's port is the fallback for environments that never ran
// `pnpm dev` — NEXT_PUBLIC_APP_URL alone is NOT reliable here, since it may be a
// portless public domain (the ngrok Base URL), which would collapse every
// worktree to the same 'default' prefix and silently defeat the isolation.
// One switch closes every sign-up path; existing accounts keep signing in.
const SIGNUPS_CLOSED = env.AUTH_SIGNUPS_CLOSED === 'true';

const DEV_COOKIE_PREFIX = (() => {
  if (process.env.NODE_ENV === 'production') return null;
  const filePort = existsSync('.dev-port') ? readFileSync('.dev-port', 'utf8').trim() : '';
  const urlPort = new URL(env.NEXT_PUBLIC_APP_URL).port;
  const prefix = `just-a-wrapper-${filePort || urlPort || 'default'}`;
  // Info level suffices because this is a developer startup diagnostic, not an audit event.
  logger().info({ prefix }, '[auth] dev cookie prefix');
  return prefix;
})();

// Passwordless only: email OTP + Google. No password.
//
// Better Auth's core `session` table is renamed to `auth_session` so it doesn't
// collide with our app's agent `session` table. The logical model stays
// "session", so the organization plugin's `activeOrganizationId` still resolves.
//
// Transactional email delivery uses the shared notification service.
const authOptions = {
  baseURL: env.NEXT_PUBLIC_APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Ownership mutations must pass through app-owned transactions that lock the
  // workspace's owner rows. Keep Better Auth's server API available for those
  // actions, but do not mount bypassable public HTTP endpoints.
  disabledPaths: [
    ...(capabilities.email.kind === 'off'
      ? ['/email-otp/send-verification-otp', '/sign-in/email-otp', '/change-email']
      : []),
    '/organization/update-member-role',
    '/organization/remove-member',
    '/organization/leave',
    '/organization/delete',
    '/organization/create',
    '/organization/set-active',
    '/organization/accept-invitation',
    '/organization/reject-invitation',
    '/organization/cancel-invitation',
  ],
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  session: { modelName: 'auth_session' },
  rateLimit: { storage: 'database' },
  // Email-change verification (Settings/Account). Better Auth's changeEmail flow
  // reuses this general `sendVerificationEmail` callback: since our accounts are
  // OTP-verified (emailVerified === true) and we do NOT enable
  // sendChangeEmailConfirmation, a change request falls through to the
  // change-email-verification branch, which sends the link to the NEW address
  // with user.email overridden to it. The
  // account keeps signing in with the current address until the new one is verified;
  // Better Auth's core /verify-email endpoint applies the swap on click. No
  // schema change — email/emailVerified/verification are core Better Auth tables.
  emailVerification: {
    async sendVerificationEmail({ user, url }) {
      await sendTransactionalEmail({
        to: user.email,
        purpose: 'verify-email',
        email: verifyEmailChangeEmail({
          url,
          expiresMinutes: 60,
          contact: await readContactDetails(),
        }),
      });
    },
  },
  // Personal display preferences persisted on the user row (Settings/General).
  // Declaring them here makes them settable through the update API and included
  // in the session user object; the actual columns live in the drizzle schema
  // (src/db/schema/auth.ts). Membership of `timezone` / `browserTimezone` in the
  // IANA set and the `timeFormat` enum is validated at our own boundaries
  // (src/features/preferences) — Better Auth only enforces the coarse type.
  user: {
    // Enable authClient.changeEmail (Settings/Account email row). See the
    // emailVerification note above for the verify-the-new-address semantics.
    changeEmail: { enabled: true },
    additionalFields: {
      timezone: { type: 'string', required: false, input: false },
      browserTimezone: { type: 'string', required: false, input: false },
      timeFormat: { type: 'string', required: false, input: false },
      replyLanguage: { type: 'string', required: false, input: false },
    },
  },
  socialProviders:
    capabilities.googleSignIn.kind === 'google'
      ? {
          google: {
            clientId: capabilities.googleSignIn.clientId,
            clientSecret: capabilities.googleSignIn.clientSecret,
            disableSignUp: SIGNUPS_CLOSED,
          },
        }
      : {},
  databaseHooks: {
    user: {
      create: {
        // The user row is committed once this runs (better-auth@1.6.16
        // dist/db/with-hooks — `after` hooks fire post-create). One capture per
        // account, ever: the durable signup moment. The hook has no
        // user in ALS context, so the id is passed explicitly.
        after: async (user) => {
          captureEvent(
            'account:signup_complete',
            { $set_once: { signup_date: new Date().toISOString() } },
            { userId: user.id },
          );
        },
      },
      update: {
        // A scheduled task tells its agent the creator's name, so a renamed person's tasks
        // are pushed at once. Settings → General pushes zone and language the same way.
        after: async (user, context) => {
          const body: unknown = context?.body;
          if (typeof body === 'object' && body !== null && 'name' in body)
            scheduleCreatorTaskSync(user.id);
        },
      },
    },
  },
  logger: { log: logBetterAuth },
  // Dev auth cookies need a port-specific prefix because browsers match cookies
  // by host, not port. A sign-in in one worktree must not replace another session.
  // Production omits the override and uses Better Auth defaults.
  ...(DEV_COOKIE_PREFIX ? { advanced: { cookiePrefix: DEV_COOKIE_PREFIX } } : {}),
  plugins: [
    emailOTP({
      // Closed sign-ups: an unknown email still gets a "code sent" answer but no
      // code, so the form cannot be used to check whether an address exists.
      disableSignUp: SIGNUPS_CLOSED,
      async sendVerificationOTP({ email, otp }) {
        // Local-dev sign-in shortcut captures the OTP in-memory (no-op unless
        // DEV_AUTH_ENABLED). See src/lib/dev-auth.ts for the safety gating.
        captureDevOtp(email, otp);
        await sendTransactionalEmail({
          to: email,
          purpose: 'sign-in-code',
          email: signInCodeEmail({
            code: otp,
            expiresMinutes: 5,
            contact: await readContactDetails(),
          }),
        });
      },
    }),
    organization({
      disableOrganizationDeletion: true,
      // Invitation emails ride the same transactional transport as
      // the sign-in OTP; the feature module owns the template + dev fallback.
      // `data.inviter` is the inviting member joined with its user row
      // (sendInvitationEmail receives {id, email, role, organization,
      // inviter: {...member, user}, invitation}).
      async sendInvitationEmail(data) {
        const emailSent = await sendInvitationEmail(
          {
            id: data.id,
            email: data.email,
            role: data.role,
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name,
            inviterEmail: data.inviter.user.email,
          },
          data.invitation,
        );
        if (!emailSent) return;
        // Better Auth creates the invitation row before calling this (crud-invites.mjs),
        // and the email is enqueued above, so the invite is durable here.
        const workspaceId = await workspaceIdForOrganization(data.organization.id);
        captureEvent(
          'team:invite_send',
          { organization_id: data.organization.id, invite_role: data.role },
          { userId: data.inviter.user.id, workspaceId },
        );
      },
      organizationHooks: {
        beforeUpdateOrganization: async ({ organization: change, member: actor }) => {
          if (change.name !== undefined)
            throw new APIError('FORBIDDEN', { message: 'Use the workspace rename action' });
          const live = await db
            .select({ id: workspace.id })
            .from(workspace)
            .where(and(eq(workspace.organizationId, actor.organizationId), workspaceNotDeleted))
            .limit(1);
          if (live.length === 0)
            throw new APIError('FORBIDDEN', { message: 'Workspace is unavailable' });
        },
        // The plan's member cap, on the path Better Auth does not check: sending
        // an invitation. Without this an admin on a 5-seat plan can send twenty
        // invitations and the refusal lands on the twenty-first INVITEE at
        // accept time, which is the wrong person at the wrong moment.
        //
        // Seats already spent = members + invitations still pending, so a
        // workspace cannot invite its way past the cap. The refusal carries the
        // plugin's own error code (so a client that switches on the code still
        // recognizes it) with OUR sentence, built from the workspace's plan.
        beforeCreateInvitation: async ({ invitation }) => {
          const organizationId = invitation.organizationId;
          await cancelExpiredInvitations(organizationId, invitation.email);
          const ws = (
            await db
              .select({ planTier: workspace.planTier })
              .from(workspace)
              .where(and(eq(workspace.organizationId, organizationId), workspaceNotDeleted))
              .limit(1)
          ).at(0);
          if (!ws) throw new APIError('FORBIDDEN', { message: 'Workspace is unavailable' });
          const refusal = await limitRefusal(ws.planTier);
          const seats = await countWorkspaceSeats(organizationId);
          if (!membersExceeded(seats.members, seats.pendingInvitations, refusal.limits)) return;
          throw new APIError('FORBIDDEN', {
            code: 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED',
            message: membersMessage(refusal),
          });
        },
      },
    }),
    nextCookies(),
  ],
} satisfies BetterAuthOptions;

export const auth = betterAuth(authOptions);
