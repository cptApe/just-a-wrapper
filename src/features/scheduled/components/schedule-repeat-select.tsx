'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Repeats } from '@/features/tasks/lib/build-cron';
import { REPEAT_OPTIONS } from '../lib/repeat-options';
import { SCHEDULE_PILL } from './schedule-control-styles';

export function ScheduleRepeatSelect({
  value,
  onChange,
}: {
  value: Repeats | 'once';
  onChange: (value: Repeats | 'once') => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === 'once') onChange('once');
        const option = REPEAT_OPTIONS.find((candidate) => candidate.value === next);
        if (option) onChange(option.value);
      }}
    >
      <SelectTrigger aria-label="Repeats" className={SCHEDULE_PILL}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="once">Once</SelectItem>
        {REPEAT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
