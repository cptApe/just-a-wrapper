import 'server-only';

import { AppError, AuthorizationError } from '@/lib/errors';
import { roleIsAtLeast } from '@/lib/workspace-role';
import { WORKSPACE_MEMORY_ADMIN_ONLY_MESSAGE } from '../constants';
import type { MemoryScope, MemoryScopeAccess } from '../types';
import { type MemoryContext, resolveMemoryContext } from './resolve';

export type ScopedStore = {
  scope: MemoryScope;
  storeId: string;
  canEdit: boolean;
  ctx: MemoryContext;
};

export function scopeAccessFor(scope: MemoryScope, ctx: MemoryContext): MemoryScopeAccess {
  const canEdit = scope === 'you' ? true : roleIsAtLeast(ctx.role, 'admin');
  return {
    scope,
    ready: Boolean(scope === 'you' ? ctx.userStoreId : ctx.workspaceStoreId),
    canEdit,
    editRefusal: canEdit ? null : WORKSPACE_MEMORY_ADMIN_ONLY_MESSAGE,
  };
}

// Require current membership and resolve stores from that member, never client IDs, to isolate tenants.
export async function resolveScopedStore(
  headers: Headers,
  scope: MemoryScope,
): Promise<ScopedStore> {
  const ctx = await resolveMemoryContext(headers);
  const storeId = scope === 'you' ? ctx.userStoreId : ctx.workspaceStoreId;
  if (!storeId) {
    throw new AppError('INTEGRATION_NOT_CONNECTED', 'memory store is not provisioned yet', {
      scope,
      organizationId: ctx.organizationId,
    });
  }
  return { scope, storeId, canEdit: scopeAccessFor(scope, ctx).canEdit, ctx };
}

// Every write checks the role server-side; hiding controls cannot enforce workspace privacy.
export async function resolveEditableStore(
  headers: Headers,
  scope: MemoryScope,
): Promise<ScopedStore> {
  const resolved = await resolveScopedStore(headers, scope);
  if (!resolved.canEdit) {
    throw new AuthorizationError(WORKSPACE_MEMORY_ADMIN_ONLY_MESSAGE, {
      scope,
      role: resolved.ctx.role,
    });
  }
  return resolved;
}
