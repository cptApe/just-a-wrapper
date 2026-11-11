import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, inArray, lt } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { invitation, member } from '@/db/schema';
import { planLimits } from '@/features/billing/api/plan-limits';
import { membersAllowed } from '@/features/billing/lib/plan-gates';
import { AppError } from '@/lib/errors';
import { invitationMachine } from '../lib/invitation-machine';
import type { WorkspaceRole } from '../lib/roles';
import { assignActiveOrganization } from './active-organization-transitions';

export async function moveInvitation(
  tx: DbTransaction,
  input: { invitationId: string; to: 'accepted' | 'rejected' | 'canceled'; now: Date },
) {
  const moved = await tx
    .update(invitation)
    .set({ status: input.to })
    .where(
      and(
        eq(invitation.id, input.invitationId),
        inArray(invitation.status, invitationMachine.sourcesOf(input.to)),
        input.to === 'accepted' ? gt(invitation.expiresAt, input.now) : undefined,
      ),
    )
    .returning();
  return moved.at(0) ?? null;
}

export async function acceptInvitationMember(
  tx: DbTransaction,
  input: {
    invitationId: string;
    organizationId: string;
    userId: string;
    sessionId: string;
    expectedOrganizationId: string | null;
    role: WorkspaceRole;
    plan: 'none' | 'pro' | 'max';
  },
) {
  const seats = await tx
    .select({ total: count() })
    .from(member)
    .where(eq(member.organizationId, input.organizationId));
  const allowed = membersAllowed(await planLimits(input.plan));
  if (seats.some(({ total }) => total >= allowed))
    throw new AppError('PLAN_LIMIT_REACHED', 'Workspace membership limit reached', {
      organizationId: input.organizationId,
    });
  const moved = await moveInvitation(tx, {
    invitationId: input.invitationId,
    to: 'accepted',
    now: new Date(),
  });
  if (moved === null) return false;
  await tx
    .insert(member)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  if (!(await assignActiveOrganization(tx, input)))
    throw new AppError('CONFLICT', 'Active workspace changed while accepting the invitation', {
      invitationId: input.invitationId,
    });
  return true;
}

export async function cancelExpiredInvitations(organizationId: string, email: string) {
  const expired = await db
    .update(invitation)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.email, email.toLowerCase()),
        inArray(invitation.status, invitationMachine.sourcesOf('canceled')),
        lt(invitation.expiresAt, new Date()),
      ),
    )
    .returning({ id: invitation.id });
  return expired.length;
}
