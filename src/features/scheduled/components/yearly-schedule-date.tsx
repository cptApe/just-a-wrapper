'use client';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMonthName } from '@/lib/format/format-date';
import { SCHEDULE_PILL } from './schedule-control-styles';

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
export function YearlyScheduleDate({
  month,
  monthDays,
  onChange,
}: {
  month: number;
  monthDays: number[];
  onChange: (next: { month: number; monthDays: number[] }) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          aria-label="Yearly date"
          className={SCHEDULE_PILL}
        >
          {formatMonthName(month)} {monthDays[0]}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-4">
        <p className="text-title-card">Every year on</p>
        <div className="flex items-center gap-3">
          <Select
            value={String(month)}
            onValueChange={(value) => {
              onChange({ month: Number(value), monthDays });
            }}
          >
            <SelectTrigger aria-label="Month" className={SCHEDULE_PILL}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, index) => (
                <SelectItem key={index} value={String(index + 1)}>
                  {formatMonthName(index + 1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(monthDays[0])}
            onValueChange={(value) => {
              onChange({ month, monthDays: [Number(value)] });
            }}
          >
            <SelectTrigger aria-label="Day of month" className={SCHEDULE_PILL}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_DAYS.map((day) => (
                <SelectItem key={day} value={String(day)}>
                  {day}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
