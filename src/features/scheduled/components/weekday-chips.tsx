'use client';

import { IconChevronDown } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WEEKDAYS } from '@/features/tasks/lib/build-cron';
import { cn } from '@/lib/utils';
import { SCHEDULE_PILL } from './schedule-control-styles';

export function WeekdayChips({
  selected,
  onToggle,
}: {
  selected: number[];
  onToggle: (value: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Days of the week" className={SCHEDULE_PILL}>
          {selected.length === 5 && [1, 2, 3, 4, 5].every((day) => selected.includes(day))
            ? 'Weekdays'
            : selected.length === 7
              ? 'Every day'
              : selected.length === 0
                ? 'Pick days'
                : WEEKDAYS.filter((d) => selected.includes(d.cron))
                    .map((d) => d.short)
                    .join(', ')}
          <IconChevronDown className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {WEEKDAYS.map((day) => (
          <DropdownMenuCheckboxItem
            key={day.cron}
            checked={selected.includes(day.cron)}
            className={cn(selected.includes(day.cron) && 'bg-schedule-blue text-on-media')}
            // Keep the menu open so several days can be picked in one pass.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(day.cron)}
          >
            {day.full}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
