'use server';

import { and, eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { type DbTransaction, db } from '@/db';
import { invitation, member, user, workspace, workspaceNotDeleted } from '@/db/schema';
import { type ActionState, runAction } from '@/lib/action-state';
import { auth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { roleIsAtLeast, workspaceRoleSchema } from '@/lib/workspace-role';
import { acceptInvitationMember, moveInvitation } from './invitation-transitions';
import { provisionWorkspaceForOrg } from './provision';

const invitationResponse = z
  .object({
    invitationId: z.string().min(1),
    decision: z.enum(['accepted', 'rejected', 'canceled']),
  })
  .strict();

type InvitationDecision = z.infer<typeof invitationResponse>['decision'];
type Viewer = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
type InvitationRow = typeof invitation.$inferSelect;

async function respondToInvitation(input: unknown, requestHeaders: Headers): Promise<void> {
  const parsed = invitationResponse.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      'VALIDATION_FAILED',
      'Invalid invitation response',
      {},
      { cause: parsed.error },
    );
  const { invitationId, decision } = parsed.data;
  const viewer = await auth.api.getSession({ headers: requestHeaders });
  if (!viewer) throw new AppError('UNAUTHENTICATED', 'Invitation response requires sign in', {});
  const accepted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(6, 0)`);
    await assertLiveAccount(tx, viewer.user.id);
    const target = (await tx.select().from(invitation).where(eq(invitation.id, invitationId))).at(
      0,
    );
    if (!target) throw new AppError('VALIDATION_FAILED', 'Invitation not found', { invitationId });
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${target.organizationId}, 5))`,
    );
    const live = (
      await tx
        .select()
        .from(workspace)
        .where(and(eq(workspace.organizationId, target.organizationId), workspaceNotDeleted))
    ).at(0);
    if (!live)
      throw new AppError('WORKSPACE_NOT_FOUND', 'Invitation workspace is unavailable', {
        organizationId: target.organizationId,
      });
    await assertMayRespond(tx, target, viewer, decision);
    if (decision === 'accepted') {
      await acceptInvitation(tx, target, viewer, live.planTier);
      return { organizationId: target.organizationId, organizationName: live.name };
    }
    if (!(await moveInvitation(tx, { invitationId: target.id, to: decision, now: new Date() })))
      throw new AppError('CONFLICT', 'Invitation already answered', { invitationId: target.id });
    return null;
  });
  if (accepted) {
    // A committed invitation stays accepted; the shell repairs incomplete provisioning.
    try {
      await provisionWorkspaceForOrg({
        organizationId: accepted.organizationId,
        name: accepted.organizationName,
        ownerUserId: viewer.user.id,
      });
    } catch (error) {
      captureException(error, { op: 'accepted-invitation-provisioning', userId: viewer.user.id });
    }
  }
}

async function assertLiveAccount(tx: DbTransaction, userId: string): Promise<void> {
  const liveUser = (
    await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.id, userId), eq(user.accountStatus, 'live')))
      .limit(1)
  ).at(0);
  if (!liveUser) throw new AppError('UNAUTHENTICATED', 'Invitation account is deleted', {});
}

// An administrator cancels an invitation. Only its addressee accepts or rejects it.
async function assertMayRespond(
  tx: DbTransaction,
  target: InvitationRow,
  viewer: Viewer,
  decision: InvitationDecision,
): Promise<void> {
  if (decision === 'canceled') {
    const actor = (
      await tx
        .select({ role: member.role })
        .from(member)
        .where(
          and(eq(member.organizationId, target.organizationId), eq(member.userId, viewer.user.id)),
        )
    ).at(0);
    if (!actor || !roleIsAtLeast(actor.role, 'admin'))
      throw new AppError('FORBIDDEN', 'Canceling an invitation requires an administrator', {});
  } else if (viewer.user.email.toLowerCase() !== target.email.toLowerCase()) {
    throw new AppError('FORBIDDEN', 'Invitation belongs to another email address', {});
  }
}

// A repeat accept by someone who already joined succeeds without moving the invitation.
async function acceptInvitation(
  tx: DbTransaction,
  target: InvitationRow,
  viewer: Viewer,
  plan: typeof workspace.$inferSelect.planTier,
): Promise<void> {
  if (target.status === 'accepted') {
    const joined = (
      await tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.organizationId, target.organizationId), eq(member.userId, viewer.user.id)),
        )
        .limit(1)
    ).at(0);
    if (joined) return;
  }
  const role = workspaceRoleSchema.parse(target.role);
  const moved = await acceptInvitationMember(tx, {
    invitationId: target.id,
    organizationId: target.organizationId,
    userId: viewer.user.id,
    sessionId: viewer.session.id,
    expectedOrganizationId: viewer.session.activeOrganizationId ?? null,
    role,
    plan,
  });
  if (!moved)
    throw new AppError('CONFLICT', 'Invitation expired or already answered', {
      invitationId: target.id,
    });
}

export async function respondToInvitationAction(input: unknown): Promise<ActionState<void>> {
  return runAction(
    {
      route: 'invitation-response',
      op: 'invitation-response',
      feature: 'workspaces',
      message: 'Could not respond to the invitation.',
      appErrorMessage: (error) => error.message,
    },
    async () => respondToInvitation(input, await headers()),
  );
}
