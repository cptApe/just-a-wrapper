'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { SettingsAvatarHero } from '@/components/settings/settings-avatar-hero';
import type { UploadConfig } from '@/features/files';
import { ProfileImageUploadModal } from '@/features/files/components/profile-image-upload-modal';
import { cleanupPreviousProfileImage } from '@/features/files/lib/client-upload';
import type { ActionState } from '@/lib/action-state';
import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/observability-client';

// Only admins may change the workspace identity; refreshing updates the server-rendered switcher.
export function WorkspaceIdentity({
  organizationId,
  name,
  logo,
  canEdit,
  uploadConfig,
}: {
  organizationId: string;
  name: string;
  logo: string | null;
  canEdit: boolean;
  uploadConfig: UploadConfig;
}) {
  const router = useRouter();
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Persist the logo URL (or null to clear) and refresh the shell. Returns a
  // failure message rather than throwing so the modal and the hero's remove path
  // can each surface it.
  async function saveLogo(nextLogo: string | null): Promise<ActionState> {
    try {
      const { error } = await authClient.organization.update({
        data: { logo: nextLogo },
        organizationId,
      });
      if (error) {
        return {
          ok: false,
          code: 'API_REQUEST_FAILED',
          message: error.message ?? 'Could not save the workspace icon. Please try again.',
        };
      }
    } catch (cause) {
      captureException(cause, { op: 'workspace.update-logo' });
      return {
        ok: false,
        code: 'API_REQUEST_FAILED',
        message: 'Could not reach the server. Check your connection and try again.',
      };
    }
    await cleanupPreviousProfileImage('workspace-icon', logo);
    router.refresh();
    return { ok: true, data: undefined };
  }

  async function handleUploaded(fileUrl: string) {
    const result = await saveLogo(fileUrl);
    if (result.ok) toast.success('Workspace icon updated');
    return result;
  }

  async function handleRemove() {
    setRemoving(true);
    const result = await saveLogo(null);
    setRemoving(false);
    if (result.ok) toast.success('Workspace icon removed');
    else {
      toast.error('Couldn’t remove the workspace icon. Try again.', {
        description: result.message,
      });
    }
  }

  if (!canEdit || !uploadConfig.enabled) {
    return (
      <>
        <SettingsAvatarHero imageUrl={logo} fallback={name} name={name} />
        {canEdit && !uploadConfig.enabled ? (
          <p className="text-meta text-muted-foreground">{uploadConfig.reason}</p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <SettingsAvatarHero
        imageUrl={logo}
        fallback={name}
        name={name}
        editable
        busy={removing}
        changeLabel="Change workspace icon"
        removeLabel="Remove workspace icon"
        onChangeImage={() => setIconModalOpen(true)}
        onRemoveImage={handleRemove}
      />
      <ProfileImageUploadModal
        kind="workspace-icon"
        open={iconModalOpen}
        onOpenChange={setIconModalOpen}
        onUploaded={handleUploaded}
      />
    </>
  );
}
