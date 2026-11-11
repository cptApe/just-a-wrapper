import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, count, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { member, organization, user, workspace, workspaceNotDeleted } from '@/db/schema';
import { captureEvent } from '@/lib/analytics';
import { AppError } from '@/lib/errors';
import { MAX_SLUG_ATTEMPTS, randomSuffix, slugify } from '../lib/personal-org';
import { initializeWorkspaceProvisioning } from './provisioning-transitions';

const MAX_OWNED_WORKSPACES = 5;

export async function listSelectableOrganizations(
  userId: string,
  reader: Pick<typeof db, 'select'>,
) {
  return reader
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId)))
    .leftJoin(workspace, eq(workspace.organizationId, organization.id))
    .where(or(isNull(workspace.id), workspaceNotDeleted))
    .orderBy(member.createdAt);
}

export async function createWorkspaceOrganization(input: {
  userId: string;
  name: string;
  kind: 'personal' | 'additional';
}): Promise<{ id: string; name: string }> {
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(6, 0)`);
    const person = (
      await tx
        .select({ status: user.accountStatus })
        .from(user)
        .where(eq(user.id, input.userId))
        .for('update')
    ).at(0);
    if (!person || person.status !== 'live')
      throw new AppError('UNAUTHENTICATED', 'Deleted account cannot create a workspace', {
        userId: input.userId,
      });
    if (input.kind === 'personal') {
      const existing = (await listSelectableOrganizations(input.userId, tx)).at(0);
      if (existing) return { organization: existing, isNew: false };
    }
    const owned = await tx
      .select({ total: count() })
      .from(member)
      .innerJoin(workspace, eq(workspace.organizationId, member.organizationId))
      .where(and(eq(member.userId, input.userId), eq(member.role, 'owner'), workspaceNotDeleted));
    if ((owned.at(0)?.total ?? 0) >= MAX_OWNED_WORKSPACES)
      throw new AppError(
        'PLAN_LIMIT_REACHED',
        `You can own at most ${MAX_OWNED_WORKSPACES} workspaces`,
        {
          userId: input.userId,
        },
      );
    const base = slugify(input.name);
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${randomSuffix()}`;
      const organizationRow = (
        await tx
          .insert(organization)
          .values({ id: randomUUID(), name: input.name, slug, createdAt: new Date() })
          .onConflictDoNothing()
          .returning({ id: organization.id, name: organization.name })
      ).at(0);
      if (!organizationRow) continue;
      await tx.insert(member).values({
        id: randomUUID(),
        organizationId: organizationRow.id,
        userId: input.userId,
        role: 'owner',
        createdAt: new Date(),
      });
      await initializeWorkspaceProvisioning(tx, {
        organizationId: organizationRow.id,
        ownerUserId: input.userId,
        name: input.name,
      });
      return { organization: organizationRow, isNew: true };
    }
    throw new AppError('CONFLICT', 'Workspace slug attempts exhausted', { userId: input.userId });
  });
  if (created.isNew)
    captureEvent(
      'workspace:create',
      { organization_id: created.organization.id },
      { userId: input.userId },
    );
  return created.organization;
}
