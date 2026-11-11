import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { member, user, workspace, workspaceMember } from '@/db/schema';
import { grantWelcomeCredits } from '@/features/billing/api/credit-ledger';
import { vaultCredentialKey } from '@/features/integrations/lib/vault-credential-key';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { capabilities } from '@/lib/runtime-capabilities';
import { provisioningMachine } from '../lib/provisioning-machine';

const { connectedApps } = capabilities;

// Configuration is fixed for this process. A deployment enabling another provider
// invalidates the prior completion and repairs resources before marking it ready.
export const provisionCapabilityKey = JSON.stringify({
  memory: Boolean(env.ANTHROPIC_API_KEY),
  vault: Boolean(env.ANTHROPIC_API_KEY) && connectedApps.kind === 'composio',
  proxyUrl: connectedApps.kind === 'composio' ? connectedApps.proxyUrl : null,
});

type ProvisionIdentity = { organizationId: string; ownerUserId: string };
function memberKey(input: ProvisionIdentity) {
  return and(
    eq(workspaceMember.organizationId, input.organizationId),
    eq(workspaceMember.userId, input.ownerUserId),
  );
}

export async function invalidateProvisioning(input: ProvisionIdentity): Promise<boolean> {
  const moved = await db
    .update(workspaceMember)
    .set({ provisioningStatus: 'pending', provisionCapabilityKey: null })
    .where(
      and(
        memberKey(input),
        inArray(workspaceMember.provisioningStatus, provisioningMachine.sourcesOf('pending')),
        or(
          isNull(workspaceMember.provisionCapabilityKey),
          ne(workspaceMember.provisionCapabilityKey, provisionCapabilityKey),
          ...(env.ANTHROPIC_API_KEY && connectedApps.kind === 'composio'
            ? [
                isNull(workspaceMember.vaultCredentialKey),
                ne(workspaceMember.vaultCredentialKey, vaultCredentialKey(connectedApps.jwtSecret)),
              ]
            : []),
        ),
      ),
    )
    .returning({ userId: workspaceMember.userId });
  return moved.length > 0;
}

export async function completeProvisioning(
  input: ProvisionIdentity & { composioUserId: string },
): Promise<boolean> {
  const moved = await db
    .update(workspaceMember)
    .set({ provisioningStatus: 'ready', provisionCapabilityKey })
    .where(
      and(
        memberKey(input),
        eq(workspaceMember.composioUserId, input.composioUserId),
        inArray(workspaceMember.provisioningStatus, provisioningMachine.sourcesOf('ready')),
      ),
    )
    .returning({ userId: workspaceMember.userId });
  return moved.length > 0;
}

export async function initializeWorkspaceProvisioning(
  tx: DbTransaction,
  input: { organizationId: string; ownerUserId: string; name: string },
): Promise<void> {
  const person = (
    await tx.select({ status: user.accountStatus }).from(user).where(eq(user.id, input.ownerUserId))
  ).at(0);
  if (!person || person.status !== 'live')
    throw new AppError('FORBIDDEN', 'Deleted accounts cannot provision workspace access', input);
  const membership = (
    await tx
      .select({ id: member.id })
      .from(member)
      .where(
        and(eq(member.organizationId, input.organizationId), eq(member.userId, input.ownerUserId)),
      )
      .for('update')
  ).at(0);
  if (!membership)
    throw new AppError('FORBIDDEN', 'Provisioning requires a live organization membership', input);
  const existingWorkspace = (
    await tx
      .select({ status: workspace.lifecycleStatus })
      .from(workspace)
      .where(eq(workspace.organizationId, input.organizationId))
  ).at(0);
  if (existingWorkspace && existingWorkspace.status !== 'live')
    throw new AppError('WORKSPACE_NOT_FOUND', 'Deleted workspace cannot be provisioned', input);
  const createdWorkspace = (
    await tx
      .insert(workspace)
      .values({
        organizationId: input.organizationId,
        name: input.name,
      })
      .onConflictDoNothing({ target: workspace.organizationId })
      .returning({ id: workspace.id })
  ).at(0);

  // Welcome credits before the member row is written, so "does this person
  // already have a workspace" reads the state from before this call.
  if (createdWorkspace) {
    await grantFirstWorkspaceWelcomeCredits(tx, {
      workspaceId: createdWorkspace.id,
      organizationId: input.organizationId,
      userId: input.ownerUserId,
    });
  }

  await tx
    .insert(workspaceMember)
    .values({
      organizationId: input.organizationId,
      userId: input.ownerUserId,
      composioUserId: randomUUID(),
    })
    .onConflictDoNothing();
}

// Creation grants welcome credits only when the owner has no other workspace membership.
// grantWelcomeCredits records the person once, so losing every membership cannot grant again.
async function grantFirstWorkspaceWelcomeCredits(
  tx: DbTransaction,
  input: { workspaceId: string; organizationId: string; userId: string },
): Promise<void> {
  const otherMembership = (
    await tx
      .select({ organizationId: workspaceMember.organizationId })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.userId, input.userId),
          ne(workspaceMember.organizationId, input.organizationId),
        ),
      )
      .limit(1)
  ).at(0);
  if (otherMembership) return;
  await grantWelcomeCredits(tx, { workspaceId: input.workspaceId, userId: input.userId });
}
