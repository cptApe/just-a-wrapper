import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { member, user, workspaceMember } from '@/db/schema';
import { AuthorizationError, BillingError } from '@/lib/errors';
import type { ActiveWorkspace } from './resolve-workspace';
import 'server-only';

export type BillingMemberLimit = {
  userId: string;
  name: string;
  email: string;
  role: string;
  creditLimit: number | null;
};

export async function listBillingMemberLimits(
  workspace: ActiveWorkspace,
): Promise<BillingMemberLimit[]> {
  return db
    .select({
      userId: member.userId,
      name: user.name,
      email: user.email,
      role: member.role,
      creditLimit: workspaceMember.creditLimit,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      workspaceMember,
      and(
        eq(workspaceMember.organizationId, member.organizationId),
        eq(workspaceMember.userId, member.userId),
      ),
    )
    .where(eq(member.organizationId, workspace.organizationId))
    .orderBy(user.name, user.email);
}

export async function updateBillingMemberLimit(input: {
  workspace: ActiveWorkspace;
  userId: string;
  creditLimit: number | null;
}): Promise<{ creditLimit: number | null }> {
  const { workspace } = input;
  const targetMember = (
    await db
      .select({ userId: member.userId })
      .from(member)
      .where(
        and(eq(member.organizationId, workspace.organizationId), eq(member.userId, input.userId)),
      )
      .limit(1)
  ).at(0);
  if (!targetMember) {
    throw new AuthorizationError('Member does not belong to the active workspace', {
      organizationId: workspace.organizationId,
      userId: input.userId,
    });
  }
  const updated = (
    await db
      .insert(workspaceMember)
      .values({
        organizationId: workspace.organizationId,
        userId: input.userId,
        composioUserId: randomUUID(),
        creditLimit: input.creditLimit,
      })
      .onConflictDoUpdate({
        target: [workspaceMember.organizationId, workspaceMember.userId],
        set: { creditLimit: input.creditLimit },
      })
      .returning({ creditLimit: workspaceMember.creditLimit })
  ).at(0);
  if (!updated)
    throw new BillingError('WORKSPACE_NOT_FOUND', 'Member disappeared during credit limit update');
  return updated;
}
