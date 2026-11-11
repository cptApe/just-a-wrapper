'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import type { ActionState } from '@/lib/action-state';
import {
  type SettingChange,
  SettingChangeList,
  SettingSourceNote,
} from './deployment-setting-history';

/**
 * An admin control for a deployment setting with a few named values. Saving goes through the one
 * settings action; the source line says whether the console or the environment decides it.
 */
export function DeploymentSettingChoice<V extends string>({
  settingKey,
  label,
  value,
  options,
  source,
  envKey,
  changes,
  save,
}: {
  settingKey: string;
  label: string;
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  source: 'stored' | 'env' | 'fallback';
  envKey: string;
  changes: readonly SettingChange[];
  save: (key: string, value: unknown) => Promise<ActionState<void>>;
}) {
  const router = useRouter();
  const mutation = useMutation({
    mutationFn: (next: V | null) => save(settingKey, next),
    onSuccess: (result, next) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(next === null ? `${label} follows ${envKey} again.` : `${label} saved.`);
      router.refresh();
    },
  });
  const pending = mutation.isPending;
  const write = (next: V | null) => mutation.mutate(next);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={label}
          value={value}
          options={options}
          disabled={pending}
          onChange={(next) => {
            if (next !== null && next !== value) write(next);
          }}
        />
        {source === 'stored' ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto"
            disabled={pending}
            onClick={() => write(null)}
          >
            Use {envKey} instead
          </Button>
        ) : null}
      </div>
      <SettingSourceNote
        source={source}
        envKey={envKey}
        fallbackNote="The default"
        verb="Choosing"
      />
      <SettingChangeList changes={changes} />
    </div>
  );
}
