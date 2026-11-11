'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/action-state';
import { captureException } from '@/lib/observability-client';
import {
  type SettingChange,
  SettingChangeList,
  SettingSourceNote,
} from './deployment-setting-history';

/**
 * An admin control for a free-text deployment setting: Edit, type, Save. Saving goes through the
 * one settings action, which validates the value; the source line says what decides it now.
 */
export function DeploymentSettingText({
  settingKey,
  label,
  value,
  inputType,
  source,
  envKey,
  changes,
  save,
}: {
  settingKey: string;
  label: string;
  value: string;
  inputType: 'email' | 'text';
  source: 'stored' | 'env' | 'fallback';
  envKey: string;
  changes: readonly SettingChange[];
  save: (key: string, value: unknown) => Promise<ActionState<void>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [clearing, setClearing] = useState(false);

  // Resolves false on any failure so the edit row stays open with the typed value.
  async function submit(next: string | null): Promise<boolean> {
    let result: ActionState<void>;
    try {
      result = await save(settingKey, next);
    } catch (cause) {
      captureException(cause, { op: 'admin.deployment-setting', key: settingKey });
      toast.error('Could not save this setting. Try again.');
      return false;
    }
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast.success(next === null ? `${label} follows ${envKey} again.` : `${label} saved.`);
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsDetailRow
        layout="stacked"
        label={label}
        value={<span translate="no">{value}</span>}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setDraft(value);
        }}
        saveDisabled={draft.trim().length === 0 || draft.trim() === value}
        onSave={() => submit(draft.trim())}
      >
        <Input
          type={inputType}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          required
          aria-label={label}
        />
      </SettingsDetailRow>
      <div className="flex flex-wrap items-center gap-3">
        <SettingSourceNote
          source={source}
          envKey={envKey}
          fallbackNote="A placeholder"
          verb="Saving"
        />
        {source === 'stored' ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto"
            disabled={clearing}
            onClick={async () => {
              setClearing(true);
              await submit(null);
              setClearing(false);
            }}
          >
            Use {envKey} instead
          </Button>
        ) : null}
      </div>
      <SettingChangeList changes={changes} />
    </div>
  );
}
