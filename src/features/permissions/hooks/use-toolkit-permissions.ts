'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganizationId } from '@/components/providers/app-providers';
import {
  toolkitPermissionsQuery,
  toolkitPermissionWrites,
} from '../api/toolkit-permission-queries';
import type { ToolSettings } from '../lib/tool-settings';
import type { ToolkitPermissions, ToolPermissionChange } from '../types';

type ToolkitPermissionsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'success'; permissions: ToolkitPermissions };

export function useToolkitPermissions(slug: string) {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId() ?? 'unscoped';
  const query = useQuery(toolkitPermissionsQuery(organizationId, slug));
  const writes = toolkitPermissionWrites(queryClient, organizationId, slug);
  const policies = useMutation(writes.policies);
  const settings = useMutation(writes.settings);

  const state: ToolkitPermissionsState =
    query.status === 'error'
      ? { kind: 'error' }
      : query.data === undefined
        ? { kind: 'loading' }
        : { kind: 'success', permissions: query.data };
  // Edits wait for the first read: there is nothing on screen to change before it lands.
  const ready = state.kind === 'success';

  return {
    state,
    updateMany: (changes: ReadonlyArray<ToolPermissionChange>) => {
      if (ready && changes.length > 0) policies.mutate(changes);
    },
    updateSettings: (toolName: string, next: ToolSettings) => {
      if (ready) settings.mutate({ toolName, settings: next });
    },
  };
}
