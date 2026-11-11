'use client';

import { IconClock } from '@/components/icons';
import type { Repeats } from '@/features/tasks/lib/build-cron';
import { SCHEDULE_CLOCK, SCHEDULE_TRIGGER_ROW } from './schedule-control-styles';
import { ScheduleDatePicker } from './schedule-date-picker';
import { ScheduleRepeatSelect } from './schedule-repeat-select';
import { ScheduleTimeSelect } from './schedule-time-select';

export function OneTimeTrigger({
  value,
  onChange,
  timezone,
  valid,
  onRepeat,
}: {
  value: string;
  onChange: (value: string) => void;
  timezone: string;
  valid: boolean;
  onRepeat: (repeat: Repeats) => void;
}) {
  const [date = '', time = '09:00'] = value.split('T');
  return (
    <div className="space-y-2">
      <div className={SCHEDULE_TRIGGER_ROW}>
        <span className={SCHEDULE_CLOCK}>
          <IconClock aria-hidden />
        </span>
        <ScheduleRepeatSelect
          value="once"
          onChange={(next) => {
            if (next !== 'once') onRepeat(next);
          }}
        />
        <span className="text-muted-foreground">on</span>
        <ScheduleDatePicker value={date} onChange={(date) => onChange(`${date}T${time}`)} />
        <span className="text-muted-foreground">at</span>
        <ScheduleTimeSelect
          label="Run time"
          value={{ hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) }}
          onChange={({ hour, minute }) =>
            onChange(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
          }
        />
      </div>
      <p className="text-meta font-normal text-muted-foreground">
        Times in {timezone}. Choose a future date within the next year.
      </p>
      {date && !valid && (
        <p role="alert" className="text-meta text-destructive">
          Choose a valid future time within the next year.
        </p>
      )}
    </div>
  );
}
