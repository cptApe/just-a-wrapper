'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { z } from 'zod';
import { type DbTransaction, db } from '@/db';
import {
  account,
  auth_session,
  member,
  user,
  workspace,
  workspaceMember,
  workspaceNotDeleted,
} from '@/db/schema';
import { tombstoneAccount } from '@/features/auth/api/account-lifecycle-transitions';
import { scheduleMemberCleanup } from '@/features/integrations/api/schedule-member-cleanup';
import { removeMembership } from '@/features/workspaces/api/membership-transitions';
import { finishDeletingWorkspaces } from '@/features/workspaces/api/purge-expired';
import { revokeMemberWorkspaceAccess } from '@/features/workspaces/api/revoke-member-workspace-access';
import { claimWorkspaceDeletion } from '@/features/workspaces/api/workspace-lifecycle-transitions';
import { workspaceActionBoundary } from '@/features/workspaces/lib/workspace-error-copy';
import { type ActionState, runAction } from '@/lib/action-state';
import { resolveUser } from '@/lib/caller';
import { AppError, type ErrorCode } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { snapshotCtx, withRequestContext } from '@/lib/request-context';
import { sweepDeadline } from '@/lib/sweep-deadline';

// Delete accounts atomically: retain the email in deletedEmail, replace it with a
// tombstone, stamp deletedAt and revoke all auth sessions in the same transaction.
// No cookie cache means the next request sees revocation.
// Map failures to a serializable result because production redacts thrown action messages.

const confirmEmailSchema = z.email();

// deleted+<userId>@deleted.agentcore.local — unique per user, never routable, so
// no OTP can ever reach it and the real address is freed for a fresh signup.

/**
 * Block deletion when the caller is the ONLY owner of any organization that has
 * at least one other LIVE member. Personal solo workspaces (the caller is the
 * sole member) do not block — their workspaces are soft-deleted instead (see
 * softDeleteSoloOrgWorkspaces) so the 30-day purge job reclaims them.
 * Checks EVERY organization the user belongs to, not just the active one. Runs
 * on the delete transaction so the reads are atomic with the writes, and counts
 * only members whose account is not already soft-deleted — a tombstoned
 * co-owner is not a real owner and must not let the last live owner through.
 */
async function assertNotSoleOwnerWithMembers(tx: DbTransaction, userId: string): Promise<void> {
  const memberships = await tx
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(member.organizationId);

  for (const membership of memberships) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${membership.organizationId}, 5))`,
    );
  }
  // Re-read after the locks: a concurrent role change can make this person the sole owner.
  const currentMemberships = await tx
    .select({ organizationId: member.organizationId, role: member.role })
    .from(member)
    .innerJoin(
      workspace,
      and(eq(workspace.organizationId, member.organizationId), workspaceNotDeleted),
    )
    .where(eq(member.userId, userId));
  const ownedOrgIds = currentMemberships
    .filter((m) => m.role === 'owner')
    .map((m) => m.organizationId);

  for (const organizationId of ownedOrgIds) {
    const liveMembers = await tx
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, organizationId), isNull(user.deletedAt)));

    const hasOtherOwner = liveMembers.some((m) => m.userId !== userId && m.role === 'owner');
    if (liveMembers.length > 1 && !hasOtherOwner) {
      throw new AppError('SOLE_OWNER_BLOCKED', 'sole owner of a workspace with other members', {
        userId,
        organizationId,
      });
    }
  }
}

/** Soft-delete workspaces where the caller is the sole live member so the purge
 * job can reclaim them. Preserve every organization with another live member.
 * Run before deleting memberships or stamping the user tombstone; exclude
 * the caller by id when counting other live members. */
async function softDeleteSoloOrgWorkspaces(
  tx: DbTransaction,
  userId: string,
  deletedAt: Date,
): Promise<string[]> {
  const deletedIds: string[] = [];
  const orgIds = (
    await tx
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
  ).map((m) => m.organizationId);

  for (const organizationId of orgIds) {
    const liveMembers = await tx
      .select({ userId: member.userId })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, organizationId), isNull(user.deletedAt)));
    const hasOtherLiveMember = liveMembers.some((m) => m.userId !== userId);
    if (hasOtherLiveMember) continue; // never touch orgs with other live members

    const target = (
      await tx
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.organizationId, organizationId))
    ).at(0);
    if (target) {
      if (await claimWorkspaceDeletion(tx, target.id, deletedAt)) deletedIds.push(target.id);
      // A lost claim means another deletion already owns provider cleanup.
    }
  }
  return deletedIds;
}

export async function deleteAccountAction(confirmEmail: string): Promise<ActionState<void>> {
  return runAction(
    {
      ...workspaceActionBoundary('settings-account-delete', 'deleteAccount'),
      expected: (error) => EXPECTED_CODES.has(error.code),
    },
    async () => {
      const h = await headers();
      const { userId, email } = await resolveUser(h);

      // Confirmation is a valid email that matches the session address
      // (case-insensitive) — the client gates on this too, but the server is the
      // authority so a scripted call with the wrong address still fails.
      const parsed = confirmEmailSchema.safeParse(confirmEmail.trim());
      if (!parsed.success || parsed.data.toLowerCase() !== email.toLowerCase()) {
        throw new AppError('VALIDATION_FAILED', 'confirmation email does not match session email', {
          userId,
        });
      }

      const deletedAt = new Date();
      const cleanup = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(6, 0)`);
        // Guard inside the tx so its reads are atomic with the writes below.
        await assertNotSoleOwnerWithMembers(tx, userId);
        // Soft-delete solo workspaces before memberships and the user tombstone.
        // Use the same tombstone timestamp for workspace and user.
        const workspaceIds = await softDeleteSoloOrgWorkspaces(tx, userId, deletedAt);
        const resources = await tx
          .select({ id: workspaceMember.composioUserId })
          .from(workspaceMember)
          .where(eq(workspaceMember.userId, userId));
        if (!(await tombstoneAccount(tx, userId, email, deletedAt))) {
          throw new AppError('CONFLICT', 'Account deletion already started', { userId });
        }
        const memberships = await tx
          .select({ organizationId: member.organizationId })
          .from(member)
          .where(eq(member.userId, userId));
        for (const membership of memberships)
          await removeMembership(tx, membership.organizationId, userId);
        // App credentials can outlive a missing auth membership after a partial offboarding.
        const orphaned = await tx
          .select({ organizationId: workspaceMember.organizationId })
          .from(workspaceMember)
          .where(eq(workspaceMember.userId, userId));
        for (const membership of orphaned)
          await revokeMemberWorkspaceAccess(tx, membership.organizationId, userId);
        // Sever provider credentials (OAuth `account` rows). The email tombstone
        // alone only closes the OTP path; Google sign-in resolves by the provider
        // account row (not email), so without this a Google-linked user could
        // re-login and even overwrite the tombstone back to the real address.
        await tx.delete(account).where(eq(account.userId, userId));
        // Drop memberships so no organization is left holding a tombstoned owner.
        // Revoke every session (same effect as auth.api.revokeSessions), atomic
        // with the tombstone.
        await tx.delete(auth_session).where(eq(auth_session.userId, userId));
        return { workspaceIds, memberIds: resources.map(({ id }) => id) };
      });

      scheduleMemberCleanup(cleanup.memberIds);
      const snapshot = snapshotCtx();
      after(() =>
        withRequestContext(snapshot, async () => {
          try {
            await finishDeletingWorkspaces(sweepDeadline(), {
              kind: 'workspaces',
              ids: cleanup.workspaceIds,
            });
          } catch (error) {
            captureException(error, { op: 'account-workspace-cleanup', userId });
          }
        }),
      );
    },
  );
}

// Bad confirmation, the sole-owner guard and an expired session are control flow, not incidents.
const EXPECTED_CODES: ReadonlySet<ErrorCode> = new Set([
  'VALIDATION_FAILED',
  'SOLE_OWNER_BLOCKED',
  'UNAUTHENTICATED',
]);
