import { formatCalendarShortDate } from '@/lib/format/format-date';
import { formatCount } from '@/lib/format/format-number';
import { cn } from '@/lib/utils';

// Daily credit-consumption bar chart, hand-rolled (no chart lib ships in this
// repo). Per the dataviz marks spec: thin bars capped at 24px, a 4px rounded-sm
// top with a square baseline, a 2px surface gap between neighbours, one series
// (so no legend — the section title names it), recessive axis text, and a
// per-bar hover tooltip. The same numbers live in the breakdown table + CSV, so
// the chart is the glance and the table is the record.

// Sparse date labels: first, middle, last — enough to anchor the axis without
// a dense, unreadable tick row.
function axisLabelIndices(count: number): Set<number> {
  if (count <= 1) return new Set([0]);
  return new Set([0, Math.floor((count - 1) / 2), count - 1]);
}

export function UsageChart({
  series,
  truncated = false,
}: {
  series: Array<{ day: string; used: number }>;
  // The window exceeded the chart's day cap; the bars show the most recent slice
  // while the headline total (summed server-side from uncapped rows) covers the
  // whole period.
  truncated?: boolean;
}) {
  const max = Math.max(1, ...series.map((d) => d.used));
  const peak = series.reduce((m, d) => Math.max(m, d.used), 0);
  const labelIndices = axisLabelIndices(series.length);

  return (
    <figure className="flex flex-col gap-2">
      {/* Show the chart-derived peak value in its header alongside any truncation note. */}
      <figcaption className="flex items-baseline justify-end gap-1.5 text-meta tabular-nums text-muted-foreground">
        {truncated ? (
          <span className="text-muted-foreground">
            chart shows the most recent {series.length} days; the total above covers the full period
            ·
          </span>
        ) : null}
        <span>Peak {formatCount(peak)} credits/day</span>
      </figcaption>
      <div className="flex h-48 items-end gap-[2px]" role="img" aria-label="Daily credits used">
        {series.map((d) => {
          const pct = (d.used / max) * 100;
          return (
            <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center">
              {/* Hover tooltip — the whole column is the hit target. */}
              <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden -translate-y-0 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-meta font-medium text-popover-foreground shadow-sm group-hover:block">
                <span className="font-medium">{formatCount(d.used)}</span> credits
                <span className="text-muted-foreground"> · {formatCalendarShortDate(d.day)}</span>
              </div>
              <div
                className={cn(
                  'w-full max-w-[24px] rounded-t bg-primary transition-colors group-hover:bg-primary/80',
                  d.used === 0 && 'bg-transparent',
                )}
                style={{ height: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
      {/* Sparse axis row aligned to the same columns. The labels are sparse
          (first · middle · last) and decorative (aria-hidden), so they stay on a
          single line — a narrow day column would otherwise wrap "Jan 1" to two
          lines, making the axis height data-dependent and impossible to reserve
          faithfully in the skeleton. */}
      <div className="flex gap-[2px]" aria-hidden>
        {series.map((d, i) => (
          <div
            key={d.day}
            // min-w-0 lets every cell stay equal-width (flex items default to
            // min-width:auto, which would otherwise clamp the labelled cells to
            // their nowrap content width and drift the labels off their bars);
            // the centered label then overflows its narrow cell symmetrically.
            className="min-w-0 flex-1 whitespace-nowrap text-center text-meta font-medium text-muted-foreground"
          >
            {labelIndices.has(i) ? formatCalendarShortDate(d.day) : ''}
          </div>
        ))}
      </div>
    </figure>
  );
}
