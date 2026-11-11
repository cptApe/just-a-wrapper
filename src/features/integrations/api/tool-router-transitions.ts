import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { workspaceMember } from '@/db/schema';

// The cached Tool Router URL carries the account pins of the moment it was minted.
// Each write bumps the generation, and a mint lands only on the generation it read
// before resolving pins, so a clear always beats a mint that started before it.

export async function persistMintedUrl(input: {
  memberId: string;
  url: string;
  mintedAt: Date;
  generation: number;
}): Promise<boolean> {
  const rows = await db
    .update(workspaceMember)
    .set({
      toolRouterUrl: input.url,
      toolRouterMintedAt: input.mintedAt,
      toolRouterGeneration: sql`${workspaceMember.toolRouterGeneration} + 1`,
    })
    .where(
      and(
        eq(workspaceMember.composioUserId, input.memberId),
        eq(workspaceMember.toolRouterGeneration, input.generation),
      ),
    )
    .returning({ id: workspaceMember.composioUserId });
  return rows.length > 0;
}

export async function clearToolRouterCache(
  target:
    | { kind: 'all' }
    | { kind: 'member'; memberId: string }
    | { kind: 'workspace'; organizationId: string },
): Promise<number> {
  const rows = await db
    .update(workspaceMember)
    .set({
      toolRouterUrl: null,
      toolRouterMintedAt: null,
      toolRouterGeneration: sql`${workspaceMember.toolRouterGeneration} + 1`,
    })
    .where(
      target.kind === 'member'
        ? eq(workspaceMember.composioUserId, target.memberId)
        : target.kind === 'workspace'
          ? eq(workspaceMember.organizationId, target.organizationId)
          : undefined,
    )
    .returning({ id: workspaceMember.composioUserId });
  return rows.length;
}
