'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useHydrated } from '@/hooks/use-hydrated';
import { brand } from '@/lib/brand/identity';
import { formatClock, formatZoneOffset } from '@/lib/format/format-date';
import { captureException } from '@/lib/observability-client';
import {
  detectTimeZone,
  IANA_TIME_ZONES,
  resolveTimeFormat,
  type TimeFormat,
} from '../lib/time-preferences';
import type { SavePreferenceAction } from '../types';

// Sentinel option value for auto-detect (stored as null on the server).
const AUTO = '__auto__';
// Live-clock re-render cadence. 30s keeps the minute display accurate without
// churn (offset + local time can only render after hydration anyway).
const TICK_MS = 30_000;

export function TimezoneRow({
  value,
  browserTimezone,
  timeFormat,
  open,
  onOpenChange,
  onSaved,
  save,
}: {
  /** The stored explicit zone (null = Auto). */
  value: string | null;
  /** The last valid IANA zone detected by the browser. */
  browserTimezone: string | null;
  /** The member's 12/24h setting (null = derive from locale), for the clock. */
  timeFormat: TimeFormat | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Report a persisted zone up so the coordinator's value stays in sync. */
  onSaved: (value: string | null) => void;
  save: SavePreferenceAction<string | null>;
}) {
  const router = useRouter();
  const mounted = useHydrated();
  const [draft, setDraft] = useState<string | null>(value);
  const [, setTick] = useState(0);

  // Live clock: re-render on a cadence so the displayed local time stays fresh.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Closing or switching rows discards unsaved edits before the next render, without a setter effect.
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (!open) {
      setDraft(value);
    }
  }

  const detectedTimeZone = mounted ? detectTimeZone() : null;
  const autoZone = browserTimezone ?? detectedTimeZone;
  const effectiveZone = value ?? autoZone;
  const effectiveFormat = resolveTimeFormat({
    timeFormat,
    locale: mounted ? navigator.language : null,
  });

  // Pre-hydration: a stable string (no client clock) to avoid a mismatch. Once
  // mounted, show the effective zone's offset and current local time.
  const displayZone = value ?? (autoZone ? `Auto · ${autoZone}` : 'Auto');
  const displayValue =
    mounted && effectiveZone
      ? `${displayZone} (${formatZoneOffset(effectiveZone)}) · ${formatClock(new Date(), { timeZone: effectiveZone, timeFormat: effectiveFormat })}`
      : displayZone;

  const options = useMemo<ComboboxOption[]>(
    () => [
      {
        value: AUTO,
        label: autoZone ? `Auto · ${autoZone}` : 'Auto',
        keywords: 'automatic detected browser',
      },
      ...IANA_TIME_ZONES.map((zone) => ({ value: zone, label: zone })),
    ],
    [autoZone],
  );

  const draftValue = draft ?? AUTO;
  const triggerLabel = draft ?? (autoZone ? `Auto · ${autoZone}` : 'Auto');

  return (
    <SettingsDetailRow
      layout="stacked"
      label="Time zone"
      value={displayValue}
      helper={`Used for dates and times across ${brand.name}`}
      open={open}
      onOpenChange={onOpenChange}
      saveDisabled={draft === value}
      onSave={async () => {
        try {
          const saved = await save(draft);
          if (!saved.ok) {
            toast.error('Couldn’t save your time zone. Try again.', {
              description: saved.message,
            });
            return false;
          }
        } catch (cause) {
          captureException(cause, { feature: 'preferences-timezone' });
          toast.error('Couldn’t save your time zone. Try again.');
          return false;
        }
        onSaved(draft);
        // The layout re-reads the zone so every date in the app moves to it.
        router.refresh();
        toast.success('Time zone saved');
        return true;
      }}
    >
      <Combobox
        ariaLabel="Time zone"
        options={options}
        value={draftValue}
        onSelect={(next) => setDraft(next === AUTO ? null : next)}
        triggerLabel={triggerLabel}
        searchPlaceholder="Search time zones"
        emptyText="No matching time zones"
        className="w-full sm:w-80"
      />
    </SettingsDetailRow>
  );
}
