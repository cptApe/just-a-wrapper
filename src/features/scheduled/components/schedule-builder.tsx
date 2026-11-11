'use client';

import { IconClock } from '@/components/icons';
import type { BuilderValues, ScheduleBuilderModel } from '../lib/schedule-form-machine';
import { HourlyScheduleRange } from './hourly-schedule-range';
import { MonthDayPicker } from './month-day-picker';
import { ScheduleBuilderSummary } from './schedule-builder-summary';
import { SCHEDULE_CLOCK, SCHEDULE_TRIGGER_ROW } from './schedule-control-styles';
import { ScheduleRepeatSelect } from './schedule-repeat-select';
import { ScheduleTimeSelect } from './schedule-time-select';
import { WeekdayChips } from './weekday-chips';
import { YearlyScheduleDate } from './yearly-schedule-date';

// Compact recurring-trigger sentence. Once uses its own date/time control. The form owns the values
// and derives the cron, so every edit reaches the saved schedule in the same render.

export function ScheduleBuilder({
  builder,
  onEdit,
  timezone,
  onOnce,
}: {
  builder: ScheduleBuilderModel;
  onEdit: (values: Partial<BuilderValues>) => void;
  onOnce: () => void;
  /** IANA zone the deployment evaluates in; named in the summary sentence. */
  timezone: string | null;
}) {
  const state = builder.values;
  const { repeats, time, weekdays, monthDays, endHour, month } = state;

  const toggle = (list: number[], value: number): number[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const monthDaySummary =
    monthDays.length === 0
      ? 'Pick days'
      : [...monthDays]
          .sort((a, b) => a - b)
          .map((d) => `Day ${d}`)
          .join(', ');

  return (
    <div className="flex flex-col gap-3">
      <div className={SCHEDULE_TRIGGER_ROW}>
        <span className={SCHEDULE_CLOCK}>
          <IconClock aria-hidden />
        </span>
        <ScheduleRepeatSelect
          value={repeats}
          onChange={(next) => {
            if (next === 'once') onOnce();
            // Yearly reads its day from monthDays, which an emptied Monthly leaves blank.
            else
              onEdit(
                next === 'yearly' && monthDays.length === 0
                  ? { repeats: next, monthDays: [1] }
                  : { repeats: next },
              );
          }}
        />
        {repeats !== 'daily' && <span className="text-muted-foreground">on</span>}
        {repeats === 'yearly' && (
          <YearlyScheduleDate month={month} monthDays={monthDays} onChange={onEdit} />
        )}
        {repeats === 'weekly' || repeats === 'hourly' ? (
          <WeekdayChips
            selected={weekdays}
            onToggle={(value) => onEdit({ weekdays: toggle(weekdays, value) })}
          />
        ) : null}

        {repeats === 'monthly' ? (
          <MonthDayPicker
            summary={monthDaySummary}
            selected={monthDays}
            onToggle={(value) => onEdit({ monthDays: toggle(monthDays, value) })}
          />
        ) : null}

        {repeats === 'hourly' ? (
          <HourlyScheduleRange time={time} endHour={endHour} onChange={onEdit} />
        ) : (
          <>
            <span className="text-muted-foreground">at</span>
            <ScheduleTimeSelect
              label="Time"
              value={time}
              onChange={(value) => onEdit({ time: value })}
            />
          </>
        )}
      </div>

      <ScheduleBuilderSummary
        state={state}
        keepsCustom={builder.kind === 'custom'}
        timezone={timezone}
      />
    </div>
  );
}
