import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { member, user as userTable, workspaceMember } from '@/db/schema';

export interface NotificationRecipient {
  userId: string;
  email: string;
  name: string | null;

  lastActiveAt: Date | null;
}

export async function recipientsForOrg(organizationId: string): Promise<NotificationRecipient[]> {
  return db
    .select({
      userId: userTable.id,
      email: userTable.email,
      name: userTable.name,
      lastActiveAt: workspaceMember.lastActiveAt,
    })
    .from(workspaceMember)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, workspaceMember.organizationId),
        eq(member.userId, workspaceMember.userId),
      ),
    )
    .innerJoin(userTable, eq(workspaceMember.userId, userTable.id))
    .where(eq(workspaceMember.organizationId, organizationId));
}
