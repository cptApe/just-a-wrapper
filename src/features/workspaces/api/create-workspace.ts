import 'server-only';
import { resolveUser } from '@/lib/caller';
import { activateOrganization } from './active-organization-transitions';
import { createWorkspaceOrganization } from './create-organization';
import { provisionWorkspaceForOrg } from './provision';

// Organization, membership and pending app rows commit together. Provider setup
// follows that commit so a failed provider leaves a visible, repairable workspace.
export async function createWorkspace(input: {
  name: string;
  headers: Headers;
}): Promise<{ organizationId: string }> {
  const { userId } = await resolveUser(input.headers);
  const organization = await createWorkspaceOrganization({
    userId: userId,
    name: input.name,
    kind: 'additional',
  });
  await provisionWorkspaceForOrg({
    organizationId: organization.id,
    ownerUserId: userId,
    name: organization.name,
  });
  await activateOrganization(input.headers, organization.id);
  return { organizationId: organization.id };
}
