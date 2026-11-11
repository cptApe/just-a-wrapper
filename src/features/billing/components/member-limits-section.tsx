'use client';

import { useReducer } from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { SettingsConfigureRow } from '@/components/settings/settings-configure-row';
import { Form } from '@/components/ui/form';
import { InlinePrompt } from '@/components/ui/inline-prompt';
import { Input } from '@/components/ui/input';
import { fetchVoid } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import type { BillingMemberLimit } from '../api/member-limits';
import { memberLimitReducer } from '../lib/member-limit-machine';

// The page gates paid-plan access; this member list has no second plan decision.
export function MemberLimitsSection({ members }: { members: BillingMemberLimit[] }) {
  if (members.length === 0) {
    return <p className="text-muted-foreground text-body">No members yet</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="divide-y divide-alpha-8">
        {members.map((member) => (
          <MemberLimitRow key={member.userId} member={member} />
        ))}
      </div>
    </div>
  );
}

function MemberLimitRow({ member }: { member: BillingMemberLimit }) {
  const displayName = member.name.trim() || member.email;
  const [state, dispatch] = useReducer(memberLimitReducer, {
    kind: 'idle',
    value: member.creditLimit?.toString() ?? '',
    saved: member.creditLimit?.toString() ?? '',
  });
  const { value, saved: savedValue } = state;
  const errorId = `creditLimit-${member.userId}-error`;

  const expectedOrganizationId = useOrganizationId();
  async function save() {
    if (expectedOrganizationId === null) {
      toast.error('Select a workspace before saving billing settings.');
      return false;
    }
    if (state.kind === 'saving') return;
    const attempt = crypto.randomUUID();
    const parsed = value.trim() === '' ? null : Number(value);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
      dispatch({ type: 'invalid' });
      return;
    }
    dispatch({ type: 'save', attempt });
    try {
      await fetchVoid('/api/billing/member-limit', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedOrganizationId,
          userId: member.userId,
          creditLimit: parsed,
        }),
      });
      dispatch({ type: 'saved', attempt });
      toast.success(`Credit limit saved for ${displayName}`);
    } catch (cause) {
      if (reloadWorkspaceChanged({ error: cause })) return false;
      captureException(cause, { feature: 'billing', op: 'member-limit', userId: member.userId });
      dispatch({ type: 'failed', attempt });
      toast.error('Couldn’t save the credit limit. Try again.');
    }
  }

  return (
    <SettingsConfigureRow label={displayName} htmlFor={`creditLimit-${member.userId}`}>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (value !== savedValue) void save();
        }}
        // The row shows its own limit error instead of the browser validation bubble.
        noValidate
        className="flex flex-col items-end gap-2"
      >
        <Input
          id={`creditLimit-${member.userId}`}
          type="number"
          placeholder="No limit"
          disabled={state.kind === 'saving'}
          onBlur={() => {
            if (value !== savedValue) void save();
          }}
          min={0}
          step={1}
          name={`creditLimit-${member.userId}`}
          autoComplete="off"
          value={value}
          onChange={(event) => {
            dispatch({ type: 'edit', value: event.target.value });
          }}
          aria-label={`Credit limit for ${displayName}`}
          className="w-36"
          aria-invalid={state.kind === 'validation_error'}
          aria-describedby={state.kind === 'validation_error' ? errorId : undefined}
        />
        {state.kind === 'validation_error' ? (
          <InlinePrompt id={errorId} className="text-meta">
            Enter zero or a positive whole number, or leave it blank.
          </InlinePrompt>
        ) : null}
      </Form>
    </SettingsConfigureRow>
  );
}
