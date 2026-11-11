import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { db } from '@/db';
import { workspaceMember } from '@/db/schema';
import { vaultMachine } from '../lib/vault-machine';

type MemberKey = { organizationId: string; userId: string };
function memberKey(input: MemberKey) {
  return and(
    eq(workspaceMember.organizationId, input.organizationId),
    eq(workspaceMember.userId, input.userId),
  );
}

export async function readMemberVault(input: MemberKey) {
  return (
    (
      await db
        .select({
          vaultId: workspaceMember.mcpProxyVaultId,
          composioUserId: workspaceMember.composioUserId,
          status: workspaceMember.vaultStatus,
          credentialUpdatedAt: workspaceMember.vaultCredentialUpdatedAt,
          credentialKey: workspaceMember.vaultCredentialKey,
        })
        .from(workspaceMember)
        .where(memberKey(input))
        .limit(1)
    ).at(0) ?? null
  );
}

export async function claimMemberVault(input: MemberKey, claimedAt: Date) {
  return (
    (
      await db
        .update(workspaceMember)
        .set({ vaultStatus: 'provisioning', vaultClaimedAt: claimedAt })
        .where(
          and(
            memberKey(input),
            inArray(workspaceMember.vaultStatus, vaultMachine.sourcesOf('provisioning')),
            or(
              inArray(workspaceMember.vaultStatus, ['unprovisioned', 'provisioned']),
              lt(workspaceMember.vaultClaimedAt, new Date(claimedAt.getTime() - 300_000)),
            ),
          ),
        )
        .returning({
          vaultId: workspaceMember.mcpProxyVaultId,
          composioUserId: workspaceMember.composioUserId,
        })
    ).at(0) ?? null
  );
}

export async function attachClaimedVault(
  input: MemberKey & { claimedAt: Date; vaultId: string },
): Promise<boolean> {
  const rows = await db
    .update(workspaceMember)
    .set({ mcpProxyVaultId: input.vaultId })
    .where(
      and(
        memberKey(input),
        eq(workspaceMember.vaultStatus, 'provisioning'),
        eq(workspaceMember.vaultClaimedAt, input.claimedAt),
      ),
    )
    .returning({ id: workspaceMember.composioUserId });
  return rows.length > 0;
}

export async function finishMemberVault(
  input: MemberKey & {
    claimedAt: Date;
    status: 'unprovisioned' | 'provisioned';
    credentialUpdatedAt: Date | null;
    credentialKey: string | null;
  },
): Promise<boolean> {
  const rows = await db
    .update(workspaceMember)
    .set({
      vaultStatus: input.status,
      vaultClaimedAt: null,
      vaultCredentialKey: input.credentialKey,
      ...(input.status === 'provisioned'
        ? { vaultCredentialUpdatedAt: input.credentialUpdatedAt }
        : {}),
    })
    .where(
      and(
        memberKey(input),
        inArray(workspaceMember.vaultStatus, vaultMachine.sourcesOf(input.status)),
        eq(workspaceMember.vaultClaimedAt, input.claimedAt),
      ),
    )
    .returning({ id: workspaceMember.composioUserId });
  return rows.length > 0;
}
