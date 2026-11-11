import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace, workspaceMember, workspaceNotDeleted } from '@/db/schema';
import {
  ensureMemberVault,
  isMemberVaultProvisioned,
} from '@/features/integrations/api/provision-vault';
import {
  areMemoryStoresProvisioned,
  ensureMemoryStores,
} from '@/features/memory/api/provision-stores';
import { arePresetSkillsProvisioned, ensurePresetSkills } from '@/features/skills/server';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { notifyProvisionedInvitee } from './notify-provisioned-invitee';
import {
  completeProvisioning,
  initializeWorkspaceProvisioning,
  invalidateProvisioning,
  provisionCapabilityKey,
} from './provisioning-transitions';

// Workspace and invitation actions commit membership before provisioning provider resources.
// Provider resources are provisioned after commit so network calls cannot hold row locks.
// Provider identities and guarded completion make retries safe.
export async function provisionWorkspaceForOrg(input: {
  organizationId: string;
  ownerUserId: string;
  name: string;
}): Promise<void> {
  await invalidateProvisioning(input);
  await db.transaction((tx) => initializeWorkspaceProvisioning(tx, input));
  const claim = await readProvisionState(input);
  if (!claim.memberExists)
    throw new AppError('CONFLICT', 'Provisioning membership was removed', input);

  await ensureMemoryStores({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  });

  await ensureMemberVault({
    refreshCredential: false,
    organizationId: input.organizationId,
    userId: input.ownerUserId,
  });

  // Preset claims serialize publication without holding a lock across provider calls.
  await ensurePresetSkills();

  const moved = await completeProvisioning({ ...input, composioUserId: claim.composioUserId });
  if (!moved) {
    const current = await readProvisionState(input);
    if (current.status !== 'ready' || current.composioUserId !== claim.composioUserId)
      throw new AppError('CONFLICT', 'Provisioning membership changed before completion', input);
  }
  // A notification failure must not revoke completed workspace provisioning.
  try {
    await notifyProvisionedInvitee(input);
  } catch (error) {
    captureException(error, { op: 'notify-provisioned-invitee', ...input });
  }
}

export async function readProvisionState(input: {
  organizationId: string;
  ownerUserId: string;
}): Promise<
  | { memberExists: false; status: 'missing'; composioUserId: null }
  | { memberExists: true; status: 'pending' | 'ready'; composioUserId: string }
> {
  const member = (
    await db
      .select({
        status: workspaceMember.provisioningStatus,
        composioUserId: workspaceMember.composioUserId,
        capabilityKey: workspaceMember.provisionCapabilityKey,
      })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.organizationId, input.organizationId),
          eq(workspaceMember.userId, input.ownerUserId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!member) return { memberExists: false, status: 'missing', composioUserId: null };
  return {
    memberExists: true,
    composioUserId: member.composioUserId,
    status: member.capabilityKey === provisionCapabilityKey ? member.status : 'pending',
  };
}

// A capability change invalidates the ready state and rechecks configured resources.
export async function isOrgFullyProvisioned(input: {
  organizationId: string;
  ownerUserId: string;
}): Promise<boolean> {
  const ws = (
    await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(and(eq(workspace.organizationId, input.organizationId), workspaceNotDeleted))
      .limit(1)
  ).at(0);
  if (!ws) {
    return false;
  }

  const member = (
    await db
      .select({ userId: workspaceMember.userId })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.organizationId, input.organizationId),
          eq(workspaceMember.userId, input.ownerUserId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!member) {
    return false;
  }

  if (!(await areMemoryStoresProvisioned(input))) {
    return false;
  }

  // The member's MCP-proxy vault must exist too (key-gated inside, so an
  // environment without the key/proxy/secret trio doesn't loop the repair path).
  if (
    !(await isMemberVaultProvisioned({
      organizationId: input.organizationId,
      userId: input.ownerUserId,
    }))
  ) {
    return false;
  }

  return arePresetSkillsProvisioned();
}
