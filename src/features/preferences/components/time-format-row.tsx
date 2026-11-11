'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { Segmented } from '@/components/ui/segmented';
import { useHydrated } from '@/hooks/use-hydrated';
import { brand } from '@/lib/brand/identity';
import { captureException } from '@/lib/observability-client';
import { resolveTimeFormat, type TimeFormat, timeFormatLabel } from '../lib/time-preferences';
import type { SavePreferenceAction } from '../types';

const OPTIONS = [
  { value: '12h' as const, label: '12h' },
  { value: '24h' as const, label: '24h' },
];

export function TimeFormatRow({
  value,
  open,
  onOpenChange,
  onSaved,
  save,
}: {
  /** The stored format (null = derive from locale). */
  value: TimeFormat | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Report a persisted format up so the coordinator's value stays in sync. */
  onSaved: (value: TimeFormat) => void;
  save: SavePreferenceAction<TimeFormat>;
}) {
  const router = useRouter();
  const mounted = useHydrated();
  const [draft, setDraft] = useState<TimeFormat | null>(value);

  // One row open at a time: revert the draft to the stored value whenever the
  // row is (re)closed. React's sanctioned reset-on-prop-change pattern.
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (!open) {
      setDraft(value);
    }
  }

  // The browser’s clock convention is known only after hydration; until then an unset
  // value reads "System default" and the draft uses the unset rule's own 12-hour fallback.
  const locale = mounted ? navigator.language : null;
  const displayValue =
    value === null && !mounted
      ? 'System default'
      : timeFormatLabel(resolveTimeFormat({ timeFormat: value, locale }));
  const draftEffective = resolveTimeFormat({ timeFormat: draft, locale });

  return (
    <SettingsDetailRow
      layout="stacked"
      label="Time format"
      value={displayValue}
      helper={`How times are shown across ${brand.name}`}
      open={open}
      onOpenChange={onOpenChange}
      saveDisabled={draft === value}
      onSave={async () => {
        try {
          const saved = await save(draftEffective);
          if (!saved.ok) {
            toast.error('Couldn’t save your time format. Try again.', {
              description: saved.message,
            });
            return false;
          }
        } catch (cause) {
          captureException(cause, { feature: 'preferences-time-format' });
          toast.error('Couldn’t save your time format. Try again.');
          return false;
        }
        onSaved(draftEffective);
        // The layout re-reads the format so every clock in the app follows it.
        router.refresh();
        toast.success('Time format saved');
        return true;
      }}
    >
      <Segmented
        label="Time format"
        size="sm"
        value={draftEffective}
        options={OPTIONS}
        onChange={(next) => next && setDraft(next)}
      />
    </SettingsDetailRow>
  );
}
