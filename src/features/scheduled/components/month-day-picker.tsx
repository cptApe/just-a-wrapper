'use client';

import { IconChevronDown } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { SCHEDULE_PILL } from './schedule-control-styles';

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
export function MonthDayPicker({
  summary,
  selected,
  onToggle,
}: {
  summary: string;
  selected: number[];
  onToggle: (value: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Days of the month"
          className={cn(SCHEDULE_PILL, 'inline-flex items-center')}
        >
          <span className="line-clamp-1 text-left">{summary}</span>
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {MONTH_DAYS.map((day) => {
          const checked = selected.includes(day);
          return (
            <DropdownMenuCheckboxItem
              key={day}
              checked={checked}
              className={cn(checked && 'bg-schedule-blue text-on-media')}
              // Keep the menu open so several days can be picked in one pass.
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => onToggle(day)}
            >
              Day {day}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
