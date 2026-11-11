'use client';

import { useRouter } from 'next/navigation';
import { useReducer, useRef } from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import type { AutoTopupSettings as AutoTopupSettingsValue } from '../api/auto-topup-settings';
import { monthlyCapError } from '../lib/auto-topup-cap';
import {
  autoTopupSettingsInitial,
  autoTopupSettingsReducer,
} from '../lib/auto-topup-settings-machine';
import { autoTopupSettingsSchema, parseBillingResponse } from '../lib/billing-response';

export function useAutoTopupSettings(initial: AutoTopupSettingsValue) {
  const router = useRouter();
  const [state, dispatch] = useReducer(autoTopupSettingsReducer, initial, autoTopupSettingsInitial);
  const {
    saved,
    draft: { enabled, threshold, credits, capDollars },
  } = state;
  const saving = state.kind === 'saving';
  const capError = state.kind === 'editing' ? state.error : null;
  const setEnabled = (enabled: boolean) => dispatch({ type: 'edit', draft: { enabled } });
  const setThreshold = (threshold: number) => dispatch({ type: 'edit', draft: { threshold } });
  const setCredits = (credits: number) => dispatch({ type: 'edit', draft: { credits } });
  const setCapDollars = (capDollars: number) => dispatch({ type: 'edit', draft: { capDollars } });
  const setCapError = (error: string | null) => dispatch({ type: 'validate', error });
  const capErrorId = 'auto-topup-monthly-cap-error';
  const capInputRef = useRef<HTMLInputElement>(null);

  const expectedOrganizationId = useOrganizationId();
  async function save() {
    if (expectedOrganizationId === null) {
      toast.error('Select a workspace before saving billing settings.');
      return false;
    }
    if (saving) return false;
    const attempt = crypto.randomUUID();
    const capProblem = monthlyCapError({ enabled, monthlyCapDollars: capDollars });
    if (capProblem) {
      setCapError(capProblem);
      capInputRef.current?.focus();
      return false;
    }
    setCapError(null);
    dispatch({ type: 'start', attempt });
    try {
      const saved = parseBillingResponse(
        autoTopupSettingsSchema,
        await fetchJson('/api/billing/auto-topup', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedOrganizationId,
            enabled,
            thresholdCredits: threshold,
            credits,
            monthlyCapDollars: capDollars,
          }),
        }),
      );
      dispatch({ type: 'saved', attempt, saved });
      toast.success('Saved');
      router.refresh();
      return true;
    } catch (cause) {
      if (reloadWorkspaceChanged({ error: cause })) return false;
      captureException(cause, { feature: 'billing', op: 'auto-topup-settings' });
      toast.error('Could not save your top-up settings. Try again.');
      dispatch({ type: 'failed', attempt });
      return false;
    }
  }

  return {
    saved,
    fields: { enabled, threshold, credits, capDollars },
    update: { setEnabled, setThreshold, setCredits, setCapDollars },
    validation: { capError, setCapError, capErrorId, capInputRef },
    submission: { saving, save },
  };
}
