import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { type BuilderState, buildCron } from '@/features/tasks/lib/build-cron';
import { describeBuilderState, withTimezone } from '@/features/tasks/lib/schedule-summary';

export function ScheduleBuilderSummary({
  state,
  keepsCustom,
  timezone,
}: {
  state: BuilderState;
  keepsCustom: boolean;
  timezone: string | null;
}) {
  const { timeFormat } = useDisplayFormat();
  const summary = keepsCustom
    ? 'Keeps its current custom schedule until you change something here'
    : buildCron(state)
      ? describeBuilderState(state, timeFormat)
      : null;
  return (
    <>
      {/* Announce changes for screen readers without duplicating the visible controls. */}
      <p
        aria-live="polite"
        className={summary && !keepsCustom ? 'sr-only' : 'text-meta text-muted-foreground'}
      >
        {summary
          ? withTimezone(summary, timezone)
          : state.repeats === 'weekly'
            ? 'Pick at least one day'
            : state.repeats === 'hourly'
              ? 'Choose days and an end time after the start time'
              : state.repeats === 'yearly'
                ? 'Choose a valid date'
                : 'Pick at least one day of the month'}
      </p>
      {state.repeats === 'monthly' && state.monthDays.some((day) => day > 28) ? (
        <p className="text-meta text-muted-foreground">Months without that day are skipped.</p>
      ) : null}
    </>
  );
}
