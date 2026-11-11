'use client';

import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented } from '@/components/ui/segmented';
import type { BuilderState } from '@/features/tasks/lib/build-cron';
import { formatWallClock } from '@/lib/format/format-date';
import { SCHEDULE_PILL } from './schedule-control-styles';

const NUMBER_FIELD =
  'h-8 w-10 px-1 text-center text-meta [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none';

/** Holds typed text until blur so "1" then "9", or clearing the field, is not rejected mid-edit. */
function ClockNumberField({
  label,
  min,
  max,
  value,
  display,
  disabled,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  display: string;
  disabled?: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commitDraft() {
    const next = Number(draft);
    if (draft && Number.isInteger(next) && next >= min && next <= max && next !== value)
      onCommit(next);
    setDraft(null);
  }
  return (
    <Input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      value={draft ?? display}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        // eslint-disable-next-line just-a-wrapper/require-form-primitive -- Commits this draft only; the surrounding Form still owns submit.
        if (event.key !== 'Enter') return;
        if (event.metaKey || event.ctrlKey) {
          // Commit before the key reaches the Form so its submit reads the new time.
          flushSync(commitDraft);
          return;
        }
        // Plain Enter only commits the draft in this nested field.
        event.preventDefault();
        event.currentTarget.blur();
      }}
      className={NUMBER_FIELD}
    />
  );
}

export function ScheduleTimeSelect({
  value,
  onChange,
  label,
  minuteLocked = false,
}: {
  value: BuilderState['time'];
  onChange: (value: BuilderState['time']) => void;
  label: string;
  minuteLocked?: boolean;
}) {
  const { timeFormat } = useDisplayFormat();
  const { hour, minute } = value;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" aria-label={label} className={SCHEDULE_PILL}>
          {formatWallClock(value, timeFormat)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-auto items-center gap-1 rounded-md p-1.5 shadow-popover"
      >
        {timeFormat === '24h' ? (
          <TwentyFourHourFields
            hour={hour}
            minute={minute}
            label={label}
            minuteLocked={minuteLocked}
            onChange={onChange}
          />
        ) : (
          <TwelveHourFields
            hour={hour}
            minute={minute}
            label={label}
            minuteLocked={minuteLocked}
            onChange={onChange}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

type ClockFieldsProps = {
  hour: number;
  minute: number;
  label: string;
  minuteLocked: boolean;
  onChange: (value: BuilderState['time']) => void;
};

/** A 0 to 23 hour and a minute, with no period, for a person who reads 24-hour time. */
function TwentyFourHourFields({ hour, minute, label, minuteLocked, onChange }: ClockFieldsProps) {
  return (
    <>
      <ClockNumberField
        label={`${label} hour`}
        min={0}
        max={23}
        value={hour}
        display={String(hour).padStart(2, '0')}
        onCommit={(next) => onChange({ hour: next, minute })}
      />
      <span className="text-meta">:</span>
      <ClockNumberField
        label={`${label} minute`}
        min={0}
        max={59}
        value={minute}
        display={String(minute).padStart(2, '0')}
        disabled={minuteLocked}
        onCommit={(next) => onChange({ hour, minute: next })}
      />
    </>
  );
}

/** A 1 to 12 hour, a minute and AM or PM. */
function TwelveHourFields({ hour, minute, label, minuteLocked, onChange }: ClockFieldsProps) {
  const period = hour < 12 ? 'am' : 'pm';
  const hour12 = hour % 12 || 12;
  const update = (nextHour: number, nextMinute: number, nextPeriod: 'am' | 'pm') => {
    onChange({ hour: (nextHour % 12) + (nextPeriod === 'pm' ? 12 : 0), minute: nextMinute });
  };
  return (
    <>
      <ClockNumberField
        label={`${label} hour`}
        min={1}
        max={12}
        value={hour12}
        display={String(hour12)}
        onCommit={(next) => update(next, minute, period)}
      />
      <span className="text-meta">:</span>
      <ClockNumberField
        label={`${label} minute`}
        min={0}
        max={59}
        value={minute}
        display={String(minute).padStart(2, '0')}
        disabled={minuteLocked}
        onCommit={(next) => update(hour12, next, period)}
      />
      <Segmented
        value={period}
        options={[
          { value: 'am', label: 'AM' },
          { value: 'pm', label: 'PM' },
        ]}
        label={`${label} period`}
        size="sm"
        onChange={(next) => {
          if (next === 'am' || next === 'pm') update(hour12, minute, next);
        }}
      />
    </>
  );
}
