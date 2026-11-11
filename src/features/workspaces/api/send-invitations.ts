import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/observability-client';
import { invitationEmailWasSent } from '../lib/invitation-sent';
import type { InviteResult } from '../lib/invite-members-machine';
import type { WorkspaceRole } from '../lib/roles';

// Better Auth has no batch invite, so each email is sent alone and reports its own result.

// The plugin's raw refusal says "organization", a word this product does not use.
const MEMBER_LIMIT_CODE = 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED';
const PLUGIN_MEMBER_LIMIT_SENTENCE = 'Organization membership limit reached';

function inviteFailureMessage(error: { code?: string; message?: string }): string | undefined {
  const message = error.message?.trim();
  if (error.code === MEMBER_LIMIT_CODE && (!message || message === PLUGIN_MEMBER_LIMIT_SENTENCE)) {
    return 'This workspace has no room for another team member.';
  }
  return message || undefined;
}

export async function sendInvitations(
  emails: string[],
  role: WorkspaceRole,
  expectedOrganizationId: string,
): Promise<InviteResult[]> {
  const results: InviteResult[] = [];
  for (const email of emails) {
    try {
      const { data, error: inviteError } = await authClient.organization.inviteMember({
        organizationId: expectedOrganizationId,
        email,
        role,
      });
      results.push(
        inviteError
          ? {
              email,
              ok: false,
              code: 'API_REQUEST_FAILED',
              message: inviteFailureMessage(inviteError) ?? '',
            }
          : { email, ok: true, data: { emailSent: invitationEmailWasSent(data) } },
      );
    } catch (cause) {
      captureException(cause, { op: 'workspace.invite-members' });
      results.push({
        email,
        ok: false,
        code: 'API_REQUEST_FAILED',
        message: 'Could not reach the server.',
      });
    }
  }
  return results;
}
