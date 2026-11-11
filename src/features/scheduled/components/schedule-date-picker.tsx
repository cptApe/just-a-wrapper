'use client';

import { useState } from 'react';
import { IconChevronLeft, IconChevronRight } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCalendarDate, formatCalendarLong, formatMonthName } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import { buildMonthGrid, dateKey, shiftMonth, toCalendarDay } from '../lib/month-grid';
import { SCHEDULE_PILL } from './schedule-control-styles';

export function ScheduleDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const seed = value ? new Date(`${value}T12:00:00`) : new Date();
    return { year: seed.getFullYear(), month: seed.getMonth() };
  });
  const [today] = useState(() => dateKey(new Date()));
  const weeks = buildMonthGrid(cursor.year, cursor.month);
  const label = value ? formatCalendarDate(value) : 'Choose date';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" aria-label="Run date" className={SCHEDULE_PILL}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(336px,calc(100vw-48px))] p-3">
        <div className="mb-3 flex items-center justify-between gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setCursor(shiftMonth(cursor, -1))}
          >
            <IconChevronLeft className="size-4" />
          </Button>
          <Select
            value={String(cursor.month)}
            onValueChange={(month) => setCursor({ ...cursor, month: Number(month) })}
          >
            <SelectTrigger aria-label="Calendar month" className={SCHEDULE_PILL}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, month) => (
                <SelectItem key={month} value={String(month)}>
                  {formatMonthName(month + 1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(cursor.year)}
            onValueChange={(year) => setCursor({ ...cursor, year: Number(year) })}
          >
            <SelectTrigger aria-label="Calendar year" className={SCHEDULE_PILL}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, index) => cursor.year - 2 + index).map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setCursor(shiftMonth(cursor, 1))}
          >
            <IconChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 text-center">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
            <span
              key={`${day}-${index}`}
              className="py-2 text-meta font-medium text-muted-foreground"
            >
              {day}
            </span>
          ))}
          {weeks.flat().map((day) => (
            <Button
              key={day.key}
              type="button"
              variant="ghost"
              aria-label={formatCalendarLong(toCalendarDay(day.date))}
              aria-pressed={day.key === value}
              aria-current={day.key === today ? 'date' : undefined}
              onClick={() => {
                onChange(day.key);
                setOpen(false);
              }}
              className={cn(
                'h-10 min-w-0 rounded-full p-0 text-meta focus-visible:ring-schedule-focus',
                !day.inMonth && 'text-muted-foreground',
                day.key === today && 'text-attention ring-1 ring-inset ring-attention',
                day.key === value && 'bg-schedule-blue text-on-media hover:bg-schedule-blue-hover',
              )}
            >
              {day.date.getDate()}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
