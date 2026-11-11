import * as nextHeaders from 'next/headers';
import { vi } from 'vitest';
// Exercise application-owned workspace actions using real signed-in sessions.
import { createWorkspaceOrganization } from '@/features/workspaces/api/create-organization';
import { respondToInvitationAction } from '@/features/workspaces/api/invitation-actions';
import { provisionWorkspaceForOrg } from '@/features/workspaces/api/provision';
import { auth } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export async function createTestWorkspace(input: {
  headers: Headers;
  body: { name: string; slug: string };
}) {
  const session = await auth.api.getSession({ headers: input.headers });
  if (!session) throw new Error('Test workspace requires sign in');
  const organization = await createWorkspaceOrganization({
    userId: session.user.id,
    name: input.body.name,
    kind: 'additional',
  });
  await provisionWorkspaceForOrg({
    organizationId: organization.id,
    ownerUserId: session.user.id,
    name: organization.name,
  });
  return organization;
}

export async function acceptTestInvitation(input: {
  headers: Headers;
  body: { invitationId: string };
}) {
  const headerRead = vi.spyOn(nextHeaders, 'headers').mockResolvedValueOnce(input.headers);
  try {
    const outcome = await respondToInvitationAction({
      invitationId: input.body.invitationId,
      decision: 'accepted',
    });
    if (!outcome.ok) throw new AppError(outcome.code, outcome.message);
  } finally {
    headerRead.mockRestore();
  }
}
