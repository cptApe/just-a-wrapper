'use client';

import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { BuilderState } from '@/features/tasks/lib/build-cron';
import { formatWallClock } from '@/lib/format/format-date';
import { SCHEDULE_PILL } from './schedule-control-styles';
import { ScheduleTimeSelect } from './schedule-time-select';

export function HourlyScheduleRange({
  time,
  endHour,
  onChange,
}: {
  time: BuilderState['time'];
  endHour: number;
  onChange: (next: { time: BuilderState['time']; endHour: number }) => void;
}) {
  const { timeFormat } = useDisplayFormat();
  const { minute } = time;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          aria-label="Hourly time range"
          className={SCHEDULE_PILL}
        >
          Between {formatWallClock(time, timeFormat)} –{' '}
          {formatWallClock({ hour: endHour, minute }, timeFormat)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-4 p-4">
        <p className="text-title-card">Run every hour</p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta text-muted-foreground">First run</span>
          <ScheduleTimeSelect
            value={time}
            onChange={(value) => {
              onChange({ time: value, endHour });
            }}
            label="First run time"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta text-muted-foreground">Last run</span>
          <ScheduleTimeSelect
            label="Last run time"
            value={{ hour: endHour, minute }}
            onChange={(value) => {
              onChange({ time, endHour: value.hour });
            }}
            minuteLocked
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
