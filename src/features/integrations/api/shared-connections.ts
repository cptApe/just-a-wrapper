import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { member, user, workspaceMember } from '@/db/schema';
import { IntegrationError } from '@/lib/errors';
import {
  createConnectLink,
  deleteConnectedAccount,
  listOwnActiveToolkits,
  readAccountStatus,
  setSharedAccountAccess,
} from '../composio/shared-connections';
import { mintToolRouterSession, type SharedAccountPins } from '../composio/tool-router';
import { workspaceConnectionOwnerId } from '../lib/shared-connection-machine';
import type { SharedConnectionView } from '../types';
import {
  abandonPendingShare,
  activateShare,
  attachPendingAccount,
  beginPendingRestart,
  beginShareRemoval,
  claimPendingShare,
  finishShareRemoval,
  readWorkspaceShares,
  type ShareRemoval,
  type WorkspaceShare,
} from './shared-connection-transitions';
import { clearToolRouterCache } from './tool-router-transitions';

// The rule: a member's own active account wins. Otherwise the member's agent uses
// the workspace's shared account. The session pin decides this, so any change to
// either side clears the cached session URL that decided it.

const PENDING_ACCOUNT_GRACE_MS = 15 * 60 * 1000;

export type SharedConnections = {
  connections: ReadonlyMap<string, SharedConnectionView>;
  ownActiveToolkits: ReadonlySet<string>;
  pins: SharedAccountPins;
};

export const NO_SHARES: SharedConnections = {
  connections: new Map(),
  ownActiveToolkits: new Set(),
  pins: {},
};

async function liveMemberIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: workspaceMember.composioUserId })
    .from(workspaceMember)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, workspaceMember.organizationId),
        eq(member.userId, workspaceMember.userId),
      ),
    )
    .innerJoin(user, and(eq(user.id, workspaceMember.userId), isNull(user.deletedAt)))
    .where(eq(workspaceMember.organizationId, organizationId));
  return rows.map((row) => row.id);
}

/** Delete the provider account, then the row. A failure leaves the claim for the sweep. */
export async function finishRemovingShare(removal: ShareRemoval, apiKey: string): Promise<void> {
  await clearToolRouterCache({ kind: 'workspace', organizationId: removal.organizationId });
  if (removal.connectedAccountId !== null)
    await deleteConnectedAccount(removal.connectedAccountId, apiKey);
  await finishShareRemoval(removal);
}

async function removeShare(share: WorkspaceShare, apiKey: string): Promise<void> {
  const removal = await beginShareRemoval(share);
  if (removal !== null) await finishRemovingShare(removal, apiKey);
}

// Sign-in finishes on Composio's side and sends no callback, so reads settle pending shares.
async function settleShare(
  share: WorkspaceShare,
  organizationId: string,
  apiKey: string,
): Promise<SharedConnectionView> {
  const sharedBy = share.sharedByName ?? 'A teammate';
  if (share.connectedAccountId === null) {
    if (Date.now() - share.createdAt.getTime() < PENDING_ACCOUNT_GRACE_MS)
      return { status: 'pending' };
    await removeShare(share, apiKey);
    return { status: 'none' };
  }
  const connectedAccountId = share.connectedAccountId;
  const status = await readAccountStatus(connectedAccountId, apiKey);
  if (share.status === 'active') {
    if (status === 'GONE') {
      await removeShare(share, apiKey);
      return { status: 'none' };
    }
    return status === 'ACTIVE'
      ? { status: 'active', sharedBy }
      : { status: 'needs-reconnect', sharedBy };
  }
  if (status === 'ACTIVE') {
    if (await activateShare({ ...share, connectedAccountId }))
      await clearToolRouterCache({ kind: 'workspace', organizationId });
    return { status: 'active', sharedBy };
  }
  if (status === 'INITIATED' || status === 'INITIALIZING') return { status: 'pending' };
  await removeShare(share, apiKey);
  return { status: 'none' };
}

export async function readSharedConnections(
  input: { organizationId: string; composioUserId: string },
  apiKey: string,
): Promise<SharedConnections> {
  const shares = await readWorkspaceShares(input.organizationId);
  if (shares.length === 0) return NO_SHARES;
  const [ownActiveToolkits, settled] = await Promise.all([
    listOwnActiveToolkits(input.composioUserId, apiKey),
    Promise.all(
      shares.map(async (share) => ({
        share,
        view: await settleShare(share, input.organizationId, apiKey),
      })),
    ),
  ]);
  const pins: SharedAccountPins = {};
  for (const { share, view } of settled) {
    if (
      view.status === 'active' &&
      share.connectedAccountId !== null &&
      !ownActiveToolkits.has(share.toolkit.toLowerCase())
    )
      pins[share.toolkit] = share.connectedAccountId;
  }
  return {
    connections: new Map(settled.map(({ share, view }) => [share.toolkit, view])),
    ownActiveToolkits,
    pins,
  };
}

/** Pins for a new session. Minting is the one sync point for the Composio allow list. */
export async function resolveSessionPins(
  input: { organizationId: string; composioUserId: string },
  apiKey: string,
): Promise<SharedAccountPins> {
  const { pins } = await readSharedConnections(input, apiKey);
  const accounts = Object.values(pins);
  if (accounts.length === 0) return pins;
  const allowedUserIds = await liveMemberIds(input.organizationId);
  await Promise.all(
    accounts.map((account) => setSharedAccountAccess(account, allowedUserIds, apiKey)),
  );
  return pins;
}

/** Start the sign-in that creates a workspace-owned SHARED account. */
export async function startWorkspaceShare(
  input: { workspaceId: string; organizationId: string; toolkit: string; sharedByUserId: string },
  apiKey: string,
): Promise<{ status: 'claimed'; redirectUrl: string } | { status: 'already-shared' }> {
  const key = { workspaceId: input.workspaceId, toolkit: input.toolkit };
  const earlier = await beginPendingRestart(key);
  if (earlier !== null) await finishRemovingShare(earlier, apiKey);
  const attempt = await claimPendingShare({ ...key, sharedByUserId: input.sharedByUserId });
  if (attempt === null) return { status: 'already-shared' };
  const claim = { ...key, attempt };
  let accountId: string | null = null;
  try {
    const { sessionId } = await mintToolRouterSession(
      workspaceConnectionOwnerId(input.workspaceId),
      apiKey,
      {},
    );
    const link = await createConnectLink({
      sessionId,
      toolkit: input.toolkit,
      apiKey,
      shareWith: await liveMemberIds(input.organizationId),
    });
    accountId = link.connectedAccountId;
    if (await attachPendingAccount({ ...claim, connectedAccountId: accountId }))
      return { status: 'claimed', redirectUrl: link.redirectUrl };
    // A newer attempt owns the row now, so nothing else would ever delete this account.
    await deleteConnectedAccount(accountId, apiKey);
    return { status: 'already-shared' };
  } catch (error) {
    await abandonPendingShare(claim);
    if (accountId !== null) await discardAccount(accountId, apiKey, error);
    throw error;
  }
}

async function discardAccount(accountId: string, apiKey: string, failure: unknown) {
  try {
    await deleteConnectedAccount(accountId, apiKey);
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Abandoned share account could not be deleted',
      { accountId },
      { cause: new AggregateError([failure, cause]) },
    );
  }
}

/** A sign-in link for a member's own account while their session is pinned to the shared one. */
export async function ownConnectLink(
  composioUserId: string,
  toolkit: string,
  apiKey: string,
): Promise<string> {
  const { sessionId } = await mintToolRouterSession(composioUserId, apiKey, {});
  const link = await createConnectLink({ sessionId, toolkit, apiKey, shareWith: null });
  return link.redirectUrl;
}

/** Stop sharing for everyone. The account is deleted, so no session can reach it again. */
export async function stopWorkspaceShare(
  input: { workspaceId: string; toolkit: string },
  apiKey: string,
): Promise<void> {
  const removal = await beginShareRemoval(input);
  if (removal !== null) await finishRemovingShare(removal, apiKey);
}
