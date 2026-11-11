'use client';

import { IconChevronLeft, IconChevronRight } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { type MonthCursor, monthLabel, shiftMonth } from '../lib/month-grid';

export function CalendarToolbarNav({
  cursor,
  onChange,
  monthFormat,
}: {
  cursor: MonthCursor;
  onChange: (cursor: MonthCursor) => void;
  monthFormat: 'short' | 'long';
}) {
  const goToday = () => {
    const now = new Date();
    onChange({ year: now.getFullYear(), month: now.getMonth() });
  };

  return (
    <div className="flex h-10 w-full min-w-0 items-center gap-1 md:h-auto md:w-auto md:justify-end">
      <h2
        aria-live="polite"
        suppressHydrationWarning
        className="mr-auto min-w-0 pr-1 text-meta font-medium tabular-nums md:mr-0 md:text-body"
      >
        <span className="md:hidden">{monthLabel(cursor, 'short')}</span>
        <span className="hidden md:inline">{monthLabel(cursor, monthFormat)}</span>
      </h2>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(cursor, -1))}
      >
        <IconChevronLeft className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next month"
        onClick={() => onChange(shiftMonth(cursor, 1))}
      >
        <IconChevronRight className="size-4" />
      </Button>
      <Button variant="secondary" size="sm" onClick={goToday}>
        Today
      </Button>
    </div>
  );
}
