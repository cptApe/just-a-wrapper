'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { Input } from '@/components/ui/input';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import { updateWorkspaceNameAction } from '../api/actions';

// router.refresh() re-renders the server layout so the sidebar header picks up the
// new name. Non-admins see it read-only; the server action enforces the same gate.
export function WorkspaceNameRow({
  initialName,
  canEdit,
}: {
  initialName: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const expectedOrganizationId = useOrganizationId();
  const [name, setName] = useState(initialName);

  if (!canEdit) {
    return (
      <SettingsDetailRow
        layout="stacked"
        label="Workspace name"
        value={initialName || '—'}
        action={
          <span className="text-meta text-muted-foreground">Only owners and admins can rename</span>
        }
      />
    );
  }

  return (
    <SettingsDetailRow
      layout="stacked"
      label="Workspace name"
      value={initialName || '—'}
      helper="Shows up in the sidebar switcher and on invitations."
      saveDisabled={name.trim().length === 0 || name.trim() === initialName.trim()}
      onCancel={() => {
        setName(initialName);
      }}
      onSave={async () => {
        if (expectedOrganizationId === null) {
          toast.error('Select a workspace before renaming it.');
          return false;
        }
        const result = await updateWorkspaceNameAction(name, expectedOrganizationId);
        if (!result.ok) {
          if (reloadWorkspaceChanged({ code: result.code })) return false;
          toast.error('Couldn’t rename the workspace. Try again.', {
            description: result.message,
          });
          return false;
        }
        setName(result.data.name);
        toast.success('Workspace renamed');
        router.refresh();
        return true;
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        required
        aria-label="Workspace name"
        data-testid="workspace-name-input"
        // Focus follows the user's explicit Edit action.
        autoFocus
      />
    </SettingsDetailRow>
  );
}
