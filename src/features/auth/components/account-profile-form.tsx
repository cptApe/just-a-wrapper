'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { SettingsAvatarHero } from '@/components/settings/settings-avatar-hero';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { SettingsSection } from '@/components/settings/settings-section';
import { Input } from '@/components/ui/input';
import { ProfileImageUploadModal } from '@/features/files/components/profile-image-upload-modal';
import { cleanupPreviousProfileImage } from '@/features/files/lib/client-upload';
import type { ActionState } from '@/lib/action-state';
import { authClient } from '@/lib/auth-client';
import { brand } from '@/lib/brand/identity';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { captureException } from '@/lib/observability-client';
import { AccountEmailRow } from './account-email-row';

// Which Personal-details row is in edit mode. Exactly one row opens at a
// time; the parent owns the open id so opening one reverts any other.
type OpenRow = 'name' | 'email' | null;

// Refresh the server shell after profile writes so every avatar uses the saved file route.
export function AccountProfileForm({
  userId,
  initialName,
  email,
  image,
  storageEnabled,
  emailEnabled,
}: {
  userId: string;
  initialName: string;
  email: string;
  image: string | null;
  storageEnabled: boolean;
  emailEnabled: boolean;
}) {
  const router = useRouter();
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [openRow, setOpenRow] = useState<OpenRow>(null);

  // Persist an avatar URL (or null to clear) and refresh the server shell so the
  // chrome avatar updates. Returns a failure message rather than throwing so the
  // modal (upload path) and the hero (remove path) can each surface it.
  async function saveAvatar(nextImage: string | null): Promise<ActionState> {
    try {
      const { error } = await authClient.updateUser({ image: nextImage });
      if (error) {
        return {
          ok: false,
          code: 'API_REQUEST_FAILED',
          message: error.message ?? 'Could not save your avatar. Please try again.',
        };
      }
    } catch (cause) {
      captureException(cause, { op: 'account.update-avatar' });
      return {
        ok: false,
        code: 'API_REQUEST_FAILED',
        message: 'Could not reach the server. Check your connection and try again.',
      };
    }
    await cleanupPreviousProfileImage('avatar', image);
    router.refresh();
    return { ok: true, data: undefined };
  }

  async function handleAvatarUploaded(fileUrl: string) {
    const result = await saveAvatar(fileUrl);
    if (result.ok) toast.success('Avatar updated');
    return result;
  }

  async function handleRemoveAvatar() {
    setRemovingAvatar(true);
    const result = await saveAvatar(null);
    setRemovingAvatar(false);
    if (result.ok) toast.success('Avatar removed');
    else {
      toast.error('Couldn’t remove your avatar. Try again.', {
        description: result.message,
      });
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col items-start gap-3 pb-12 max-md:pb-0">
        {storageEnabled ? (
          <>
            <SettingsAvatarHero
              imageUrl={image}
              fallback={initialName || email}
              name={initialName || email}
              secondary={email}
              editable
              busy={removingAvatar}
              changeLabel="Change avatar"
              removeLabel="Remove avatar"
              onChangeImage={() => setAvatarModalOpen(true)}
              onRemoveImage={handleRemoveAvatar}
            />
            <ProfileImageUploadModal
              kind="avatar"
              open={avatarModalOpen}
              onOpenChange={setAvatarModalOpen}
              onUploaded={handleAvatarUploaded}
            />
          </>
        ) : (
          <>
            <SettingsAvatarHero
              imageUrl={image}
              fallback={initialName || email}
              name={initialName || email}
              secondary={email}
            />
            <p className="text-meta text-muted-foreground">{CAPABILITY_OFF_MESSAGES.uploads}</p>
          </>
        )}
      </div>

      <SettingsSection title="Personal details" divided={false}>
        <NameRow
          initialName={initialName}
          open={openRow === 'name'}
          onOpenChange={(next) => setOpenRow(next ? 'name' : null)}
        />
        <AccountEmailRow
          userId={userId}
          email={email}
          emailEnabled={emailEnabled}
          open={openRow === 'email'}
          onOpenChange={(next) => setOpenRow(next ? 'email' : null)}
        />
      </SettingsSection>
    </div>
  );
}

function NameRow({
  initialName,
  open,
  onOpenChange,
}: {
  initialName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);

  // One row open at a time: when the parent closes this row — Cancel, a
  // successful save, or a sibling opening — revert the draft. Programmatic
  // closes don't call onCancel, so reset on the open→false
  // transition (React's sanctioned reset-on-prop-change pattern).
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (!open) {
      setName(initialName);
    }
  }

  return (
    <SettingsDetailRow
      layout="stacked"
      label="Name"
      value={initialName || '—'}
      helper={`How your name appears across ${brand.name}`}
      open={open}
      onOpenChange={onOpenChange}
      saveDisabled={name.trim().length === 0 || name.trim() === initialName.trim()}
      onSave={async () => {
        try {
          const { error } = await authClient.updateUser({ name: name.trim() });
          if (error) {
            toast.error('Couldn’t save your name. Try again.', {
              description: error.message,
            });
            return false;
          }
        } catch (cause) {
          captureException(cause, { op: 'account.update-name' });
          toast.error('Couldn’t save your name. Try again.');
          return false;
        }
        toast.success('Profile updated');
        router.refresh();
        return true;
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        required
        aria-label="Display name"
        data-testid="account-name-input"
        // Focus follows the user's explicit Edit action.
        autoFocus
      />
    </SettingsDetailRow>
  );
}
