'use client';

import { DelayedTooltip } from '@/components/ui/tooltip';
import type { UsageByTypeRow } from '@/features/billing';
import { formatCalendarShortDate } from '@/lib/format/format-date';
import { formatCount } from '@/lib/format/format-number';
import { plural } from '@/lib/format/plural';

// Always render the four spend types, including zero values, in this order.
// Together with headline and balance they form six stable rows matching the skeleton.
const TYPE_ROWS: ReadonlyArray<{ eventType: string; label: string }> = [
  { eventType: 'model_request', label: 'Model usage' },
  { eventType: 'voice_tts', label: 'Voice output' },
  { eventType: 'container_runtime', label: 'Computer runtime' },
  { eventType: 'voice_transcription', label: 'Voice input' },
];

// Six label/value rows show period spend, balance and four spend types.
// Headline and balance carry emphasis; type rows expose event counts on hover.
export function UsageSummary({
  usedThisPeriod,
  creditBalance,
  showRemaining,
  byType,
  fromDay,
  toDay,
}: {
  usedThisPeriod: number;
  creditBalance: number;
  showRemaining: boolean;
  byType: UsageByTypeRow[];
  fromDay: string;
  toDay: string;
}) {
  const byTypeMap = new Map(byType.map((r) => [r.eventType, r]));

  return (
    <div className="flex flex-col" data-testid="usage-summary">
      <SummaryRow
        label="Credits used this period"
        sublabel={`${formatCalendarShortDate(fromDay)} to ${formatCalendarShortDate(toDay)}`}
        value={formatCount(usedThisPeriod)}
        emphasis
      />
      {showRemaining ? (
        <SummaryRow
          label="Remaining balance"
          sublabel="Workspace credits"
          value={formatCount(creditBalance)}
          emphasis
        />
      ) : null}

      <div className="flex flex-col pt-2" data-testid="usage-by-type">
        {TYPE_ROWS.map((row) => {
          const hit = byTypeMap.get(row.eventType);
          const credits = hit?.credits ?? 0;
          const events = hit?.events ?? 0;
          return (
            <DelayedTooltip
              key={row.eventType}
              content={plural(events, 'event')}
              side="right"
              delay={300}
            >
              <div
                tabIndex={0}
                className="flex items-baseline justify-between gap-4 rounded-sm py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="text-meta text-muted-foreground">{row.label}</span>
                <span className="text-meta font-medium tabular-nums">{formatCount(credits)}</span>
              </div>
            </DelayedTooltip>
          );
        })}
      </div>
    </div>
  );
}

// One summary row: label (with an optional muted sub-line) on the left, the value
// right-aligned. `emphasis` is the two headline rows (foreground label, semibold
// value); the type rows pass it off for a recessive, breakdown weight.
function SummaryRow({
  label,
  sublabel,
  value,
  emphasis = false,
}: {
  label: string;
  sublabel?: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <div className="flex flex-col gap-0.5">
        <span className={emphasis ? 'text-body font-medium' : 'text-meta text-muted-foreground'}>
          {label}
        </span>
        {sublabel ? (
          <span className="text-meta font-medium text-muted-foreground">{sublabel}</span>
        ) : null}
      </div>
      <span
        className={
          emphasis ? 'text-body font-semibold tabular-nums' : 'text-meta font-medium tabular-nums'
        }
      >
        {value}
      </span>
    </div>
  );
}
