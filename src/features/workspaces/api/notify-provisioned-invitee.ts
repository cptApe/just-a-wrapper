import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { invitation, user } from '@/db/schema';
import { notify } from '@/features/notifications/server';
import { primaryRole } from '../lib/roles';
import { listWorkspaceMembers } from './members';

export async function notifyProvisionedInvitee(input: {
  organizationId: string;
  ownerUserId: string;
  name: string;
}): Promise<void> {
  const accepted = (
    await db
      .select({ id: invitation.id })
      .from(invitation)
      .innerJoin(user, and(eq(user.email, invitation.email), eq(user.id, input.ownerUserId)))
      .where(
        and(eq(invitation.organizationId, input.organizationId), eq(invitation.status, 'accepted')),
      )
      .limit(1)
  ).at(0);
  if (!accepted) return;
  await notifyMemberJoined({
    organizationId: input.organizationId,
    userId: input.ownerUserId,
    organizationName: input.name,
  });
}

// Fan out the two invite-accept notifications:
//  - team.member_joined → owner + admins (except the joiner): a new teammate is in
//  - team.added_to_workspace → the joiner only: welcome / where you landed
async function notifyMemberJoined(input: {
  organizationId: string;
  userId: string;
  organizationName: string;
}): Promise<void> {
  const members = await listWorkspaceMembers(input.organizationId);
  const joiner = members.find((m) => m.userId === input.userId);
  const joinerName = joiner?.name.trim() || 'A new teammate';

  const adminsAndOwner = members
    .filter((m) => m.userId !== input.userId)
    .filter((m) => {
      const role = primaryRole(m.role);
      return role === 'owner' || role === 'admin';
    })
    .map((m) => m.userId);

  if (adminsAndOwner.length > 0) {
    await notify('team.member_joined', {
      organizationId: input.organizationId,
      recipientUserIds: adminsAndOwner,
      idempotencyKey: `team-member-joined:${input.organizationId}:${input.userId}`,
      data: {
        title: `${joinerName} joined ${input.organizationName}`,
        body: 'A new member joined your workspace.',
      },
    });
  }

  await notify('team.added_to_workspace', {
    organizationId: input.organizationId,
    recipientUserIds: [input.userId],
    idempotencyKey: `team-added:${input.organizationId}:${input.userId}`,
    data: {
      title: `You joined ${input.organizationName}`,
      body: 'You now have access to this workspace.',
    },
  });
}
