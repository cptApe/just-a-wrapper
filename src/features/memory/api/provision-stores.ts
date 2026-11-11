import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { user, workspace, workspaceMember } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import {
  USER_STORE_DESCRIPTION,
  USER_STORE_NAME,
  WORKSPACE_STORE_DESCRIPTION,
  WORKSPACE_STORE_NAME,
} from '../lib/memory';
import { provisionStore } from './store-transitions';

export async function ensureMemoryStores(input: {
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  const client = getAnthropicClient();
  if (client === null) {
    captureException(
      new AppError('INTEGRATION_NOT_CONNECTED', 'Memory provisioning requires Anthropic', input),
    );
    return;
  }
  const workspaceRow = (
    await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.organizationId, input.organizationId))
  ).at(0);
  if (workspaceRow)
    await provisionStore(
      client,
      { kind: 'workspace', id: workspaceRow.id },
      {
        name: WORKSPACE_STORE_NAME,
        description: WORKSPACE_STORE_DESCRIPTION,
        metadata: { organization_id: input.organizationId },
      },
    );
  const member = (
    await db
      .select({ userName: user.name })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(
        and(
          eq(workspaceMember.organizationId, input.organizationId),
          eq(workspaceMember.userId, input.ownerUserId),
        ),
      )
  ).at(0);
  if (member)
    await provisionStore(
      client,
      { kind: 'member', organizationId: input.organizationId, userId: input.ownerUserId },
      {
        name: USER_STORE_NAME,
        description: USER_STORE_DESCRIPTION(member.userName),
        metadata: { organization_id: input.organizationId, user_id: input.ownerUserId },
      },
    );
}

// Missing configuration cannot satisfy provisioning.
export async function areMemoryStoresProvisioned(input: {
  organizationId: string;
  ownerUserId: string;
}): Promise<boolean> {
  if (!getAnthropicClient()) {
    return false;
  }
  const ws = (
    await db
      .select({ storeId: workspace.workspaceMemoryStoreId })
      .from(workspace)
      .where(eq(workspace.organizationId, input.organizationId))
      .limit(1)
  ).at(0);
  if (!ws?.storeId) {
    return false;
  }
  const member = (
    await db
      .select({ storeId: workspaceMember.userMemoryStoreId })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.organizationId, input.organizationId),
          eq(workspaceMember.userId, input.ownerUserId),
        ),
      )
      .limit(1)
  ).at(0);
  return Boolean(member?.storeId);
}
