import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { workspace, workspaceMember, workspaceNotDeleted } from '@/db/schema';
import { auth } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { snapshotCtx, withRequestContext } from '@/lib/request-context';
import { activateOrganization } from './active-organization-transitions';
import { createWorkspaceOrganization, listSelectableOrganizations } from './create-organization';
import { notifyProvisionedInvitee } from './notify-provisioned-invitee';
import { isOrgFullyProvisioned, provisionWorkspaceForOrg, readProvisionState } from './provision';
import { completeProvisioning, invalidateProvisioning } from './provisioning-transitions';

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

/** The shell gate passes the session it already read, so a refresh does not read it twice. */
export async function ensurePersonalWorkspace(
  headers: Headers,
  knownSession?: AuthSession,
): Promise<string> {
  const session = knownSession ?? (await auth.api.getSession({ headers }));
  if (!session) throw new AppError('UNAUTHENTICATED', 'Workspace resolution requires a session');
  const organizations = await listSelectableOrganizations(session.user.id, db);
  const active = organizations.find((entry) => entry.id === session.session.activeOrganizationId);
  const first = organizations.at(0);
  let selected: { id: string; name: string };
  if (active) selected = active;
  else if (first) selected = first;
  else
    selected = await createWorkspaceOrganization({
      userId: session.user.id,
      name: session.user.name.trim() === '' ? session.user.email : session.user.name.trim(),
      kind: 'personal',
    });
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .innerJoin(
      workspaceMember,
      and(
        eq(workspaceMember.organizationId, workspace.organizationId),
        eq(workspaceMember.userId, session.user.id),
      ),
    )
    .where(and(eq(workspace.organizationId, selected.id), workspaceNotDeleted))
    .limit(1);
  if ((!active && !first) || rows.length === 0)
    await provisionWorkspaceForOrg({
      organizationId: selected.id,
      ownerUserId: session.user.id,
      name: selected.name,
    });
  else scheduleProvisioningRepair(headers);
  if (selected.id !== session.session.activeOrganizationId) {
    await activateOrganization(headers, selected.id);
  }
  return selected.id;
}

const repairAfter = new Map<string, number>();
const REPAIR_COOLDOWN_MS = 60_000;

export function scheduleProvisioningRepair(headers: Headers): void {
  const snapshot = snapshotCtx();
  after(() =>
    withRequestContext(snapshot, async () => {
      const session = await auth.api.getSession({ headers });
      if (!session) return;
      const key = session.user.id;
      if ((repairAfter.get(key) ?? 0) > Date.now()) return;
      repairAfter.set(key, Date.now() + REPAIR_COOLDOWN_MS);
      try {
        const organizations = await listSelectableOrganizations(session.user.id, db);
        const selected = organizations.find(
          (entry) => entry.id === session.session.activeOrganizationId,
        );
        if (selected) await ensureProvisioned(selected, session.user.id);
      } catch (error) {
        // This background boundary reports a failed repair; the next request retries after cooldown.
        captureException(error, { op: 'provisioning-repair', userId: key });
      }
    }),
  );
}

async function ensureProvisioned(
  selected: { id: string; name: string },
  ownerUserId: string,
): Promise<void> {
  const input = { organizationId: selected.id, ownerUserId };
  await invalidateProvisioning(input);
  const state = await readProvisionState(input);
  if (state.status === 'ready') return;
  if (state.memberExists && (await isOrgFullyProvisioned(input))) {
    const moved = await completeProvisioning({ ...input, composioUserId: state.composioUserId });
    if (!moved) {
      const current = await readProvisionState(input);
      if (current.status !== 'ready' || current.composioUserId !== state.composioUserId)
        throw new AppError('CONFLICT', 'Provisioning membership changed during repair', input);
    }
    // Invite notifications do not determine access to a provisioned workspace.
    try {
      await notifyProvisionedInvitee({ ...input, name: selected.name });
    } catch (error) {
      captureException(error, { op: 'notify-provisioned-invitee', ...input });
    }
    return;
  }
  await provisionWorkspaceForOrg({ ...input, name: selected.name });
}
