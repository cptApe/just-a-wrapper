import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { member } from '@/db/schema';
import type { WorkspaceRole } from '../lib/roles';

export async function moveMemberRole(
  tx: DbTransaction,
  input: { memberId: string; organizationId: string; from: WorkspaceRole; to: WorkspaceRole },
) {
  const moved = await tx
    .update(member)
    .set({ role: input.to })
    .where(
      and(
        eq(member.id, input.memberId),
        eq(member.organizationId, input.organizationId),
        eq(member.role, input.from),
      ),
    )
    .returning({ id: member.id });
  return moved.length === 1;
}
