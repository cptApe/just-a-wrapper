'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { DangerConfirmDialog } from '@/components/settings/danger-confirm-dialog';
import { RowAction } from '@/components/settings/row-action';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { SettingsSection } from '@/components/settings/settings-section';
import { resetIdentity } from '@/lib/analytics-client';
import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/observability-client';
import { deleteAccountAction } from '../api/delete-account';

// Require the session email, case-insensitively, to enable account-delete confirmation.
// The server revalidates and revokes sessions; success clears the client cookie
// and navigates to the root.

export function DeleteAccountSection({ email }: { email: string }) {
  const [open, setOpen] = useState(false);

  return (
    <SettingsSection title="Manage account" divided={false}>
      <SettingsDetailRow
        layout="stacked"
        label="Delete account"
        value="Permanently delete your account"
        action={
          <RowAction destructive onClick={() => setOpen(true)}>
            Delete
          </RowAction>
        }
      />
      <DangerConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete account"
        description="Deleting your account is permanent and irreversible. You’ll lose all your workspaces, tasks, files, and chat history."
        confirmPhrase={email}
        confirmLabel="Delete account"
        pendingLabel="Deleting…"
        normalize={(value) => value.trim().toLowerCase()}
        onConfirm={async (typed) => {
          const result = await deleteAccountAction(typed);
          if (!result.ok) {
            toast.error('Couldn’t delete your account. Try again.', {
              description: result.message,
            });
            return false;
          }
          toast.success('Account deleted');
          // Sessions are already revoked server-side; clear the client cookie and
          // hard-navigate to the root (a fresh, unauthenticated load).
          try {
            await authClient.signOut();
          } catch (cause) {
            // The session row is already gone, so sign-out can 401 — best effort.
            captureException(cause, { op: 'account.delete.signout' });
          }
          // Drop the PostHog identity for the now-deleted person.
          resetIdentity();
          window.location.href = '/';
          return true;
        }}
      />
    </SettingsSection>
  );
}
