'use client';

import { useEffect, useId, useReducer, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { RowAction } from '@/components/settings/row-action';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { Input } from '@/components/ui/input';
import { useAsyncAction } from '@/hooks/use-async-action';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { captureException } from '@/lib/observability-client';
import { requestEmailChange } from '../api/request-email-change';
import { emailDraftReducer } from '../lib/email-change-machine';
import {
  clearVerifiedEmailChange,
  readPendingEmailChange,
  savePendingEmailChange,
  subscribePendingEmailChange,
} from '../lib/pending-email-change';

// The request marker survives reloads; Better Auth's verification link owns the actual email change.

export function AccountEmailRow({
  userId,
  email,
  emailEnabled,
  open,
  onOpenChange,
}: {
  userId: string;
  email: string;
  emailEnabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, dispatch] = useReducer(emailDraftReducer, { kind: 'editing', value: '' });
  const value = draft.value;
  const validationError = draft.kind === 'invalid' ? draft.message : null;
  const pendingEmail = useSyncExternalStore(
    subscribePendingEmailChange,
    () => readPendingEmailChange(userId, email),
    () => null,
  );
  useEffect(() => {
    clearVerifiedEmailChange(userId, email);
  }, [userId, email]);
  const resend = useAsyncAction();
  const resending = resend.pending;
  const validationErrorId = useId();

  // One row open at a time: revert the draft + validation when the parent closes this
  // row (Cancel, save, or a sibling opening). The pendingEmail marker persists —
  // it reflects a real in-flight verification, not edit-draft state. React's
  // sanctioned reset-on-prop-change pattern (programmatic closes skip onCancel).
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (!open) {
      dispatch({ type: 'reset' });
    }
  }

  async function handleResend() {
    if (!pendingEmail) return;
    const token = resend.begin();
    if (token === null) return;
    try {
      const result = await requestEmailChange(email, pendingEmail);
      if (!resend.isCurrent(token)) return;
      if (result.ok) {
        savePendingEmailChange(userId, email, pendingEmail);
        toast.success('Verification email resent');
      } else
        toast.error('Couldn’t resend the verification email. Try again.', {
          description: result.message,
        });
    } catch (cause) {
      if (!resend.isCurrent(token)) return;
      captureException(cause, { op: 'auth.email-change.resend' });
      toast.error('Couldn’t resend the verification email. Try again.');
    } finally {
      resend.finish(token);
    }
  }

  return (
    <SettingsDetailRow
      layout="stacked"
      open={open}
      onOpenChange={onOpenChange}
      label="Email"
      value={
        <span className="flex flex-col gap-1">
          <span className="break-words">{email}</span>
          {pendingEmail ? (
            <span className="flex flex-wrap items-center gap-x-2 text-meta text-muted-foreground">
              <span>Verification sent to {pendingEmail}</span>
              <RowAction
                className="text-meta font-medium"
                onClick={handleResend}
                disabled={resending}
              >
                {resending ? 'Resending…' : 'Resend'}
              </RowAction>
            </span>
          ) : null}
        </span>
      }
      helper={
        emailEnabled
          ? 'We’ll send a verification link to your new address'
          : CAPABILITY_OFF_MESSAGES.email
      }
      saveLabel="Send verification"
      saveDisabled={!emailEnabled || value.trim().length === 0}
      onSave={async () => {
        dispatch({ type: 'edit', value });
        const newEmail = value.trim();
        const result = await requestEmailChange(email, newEmail);
        if (!result.ok) {
          if (result.code === 'VALIDATION_FAILED') {
            dispatch({ type: 'invalid', message: result.message });
          } else {
            toast.error('Couldn’t send the verification email. Try again.', {
              description: result.message,
            });
          }
          return false;
        }
        savePendingEmailChange(userId, email, result.data.email);
        dispatch({ type: 'reset' });
        toast.success('Verification email sent');
        return true;
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Input
          type="email"
          value={value}
          onChange={(e) => {
            dispatch({ type: 'edit', value: e.target.value });
          }}
          placeholder="you@example.com"
          maxLength={254}
          autoComplete="email"
          aria-label="New email address"
          aria-invalid={validationError !== null}
          aria-describedby={validationError ? validationErrorId : undefined}
          data-testid="account-email-input"
          // Focus follows the user's explicit Edit action.
          autoFocus
        />
        <div className="min-h-5">
          {validationError ? (
            <p id={validationErrorId} role="alert" className="text-meta text-destructive">
              {validationError}
            </p>
          ) : null}
        </div>
      </div>
    </SettingsDetailRow>
  );
}
