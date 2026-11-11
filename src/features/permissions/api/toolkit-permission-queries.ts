'use client';

import { hashKey, type QueryClient } from '@tanstack/react-query';
import { captureException } from '@/lib/observability-client';
import { optimisticMutation } from '@/lib/optimistic-mutation';
import type { ToolSettings } from '../lib/tool-settings';
import type { PolicyTarget, ToolkitPermissions, ToolPermissionChange, ToolPolicy } from '../types';
import { permissionQueryKeys } from './keys';
// The action file is the feature's client-safe server boundary.
import { getToolkitPermissions, setToolPermissions, setToolSettings } from './tool-policies';

const SAVE_ERROR_COPY =
  'Couldn’t confirm that change. Your saved permissions have been reloaded. Try again.';

export type SettingsChange = { toolName: string; settings: ToolSettings };

export function toolkitPermissionsQuery(organizationId: string, slug: string) {
  return {
    queryKey: permissionQueryKeys.toolkit(organizationId, slug),
    queryFn: async () => {
      try {
        return await getToolkitPermissions(slug);
      } catch (error) {
        captureException(error, { op: 'toolkit-permissions-load', slug });
        throw error;
      }
    },
    // Each open reads the saved rows again, because another tab may have changed them.
    gcTime: 0,
    retry: false,
  };
}

// Both writes share one mutation scope, so the database applies them in the order the user made
// them. A failed write restores the last saved choices; the settling refetch reads what the server kept.
export function toolkitPermissionWrites(client: QueryClient, organizationId: string, slug: string) {
  const key = permissionQueryKeys.toolkit(organizationId, slug);
  const scope = { id: hashKey(key) };
  const edit = (change: (permissions: ToolkitPermissions) => ToolkitPermissions) =>
    client.setQueryData<ToolkitPermissions>(key, (current) =>
      current ? change(current) : current,
    );
  const failure = (error: Error) => {
    captureException(error, { op: 'toolkit-permissions-save', slug });
    return { message: SAVE_ERROR_COPY };
  };

  return {
    policies: {
      mutationFn: (changes: ReadonlyArray<ToolPermissionChange>) =>
        setToolPermissions({ toolkit: slug, changes }),
      scope,
      ...optimisticMutation(client, {
        root: key,
        apply: (changes: ReadonlyArray<ToolPermissionChange>) =>
          edit((permissions) =>
            changes.reduce(
              (next, change) => applyTarget(next, change.target, change.policy),
              permissions,
            ),
          ),
        failure,
      }),
    },
    settings: {
      mutationFn: ({ toolName, settings }: SettingsChange) =>
        setToolSettings({ toolkit: slug, toolName, settings }),
      scope,
      ...optimisticMutation(client, {
        root: key,
        apply: ({ toolName, settings }: SettingsChange) =>
          edit((permissions) => ({
            ...permissions,
            settings: { ...permissions.settings, [toolName]: settings },
          })),
        failure,
      }),
    },
  };
}

function applyTarget(
  permissions: ToolkitPermissions,
  target: PolicyTarget,
  policy: ToolPolicy | null,
): ToolkitPermissions {
  const tools = { ...permissions.tools };
  if (policy === null) delete tools[target.toolName];
  else tools[target.toolName] = policy;
  return { ...permissions, tools };
}
