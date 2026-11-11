import {
  type BuilderState,
  buildCron,
  isBuilderCron,
  parseCron,
} from '@/features/tasks/lib/build-cron';
import type { EventSelection, TriggerChoice } from '@/features/tasks/types';

type RepeatingChoice = Exclude<TriggerChoice, 'once' | 'event'>;
export type BuilderValues = BuilderState & { month: number; endHour: number };

/**
 * The recurring-schedule builder. A saved cron the builder cannot show stays `custom` and is saved
 * unchanged until the person edits a value; every edit makes it `editing`, whose cron is derived.
 */
export type ScheduleBuilderModel =
  | { kind: 'custom'; cron: string; values: BuilderValues }
  | { kind: 'editing'; values: BuilderValues };

export type ScheduleTrigger =
  | { kind: 'none' }
  | { kind: 'once'; value: string }
  | { kind: 'repeating'; choice: RepeatingChoice; builder: ScheduleBuilderModel }
  | { kind: 'event'; selection: EventSelection | null };

/** What a schedule opened with: its trigger choice, its saved cron, and a template's builder values. */
export type ScheduleTriggerOrigin = {
  choice: TriggerChoice | null;
  savedCron: string | null;
  seed: BuilderState | null;
};

type TriggerEvent =
  | { type: 'choose'; choice: TriggerChoice | null; origin: ScheduleTriggerOrigin }
  | { type: 'date'; value: string }
  | { type: 'edit'; values: Partial<BuilderValues> }
  | { type: 'event'; value: EventSelection | null };

const DEFAULT_BUILDER: BuilderState = {
  repeats: 'daily',
  time: { hour: 8, minute: 0 },
  weekdays: [1],
  monthDays: [1],
};

// A saved cron describes only the cadence it was saved with, so another cadence starts fresh.
function repeatingBuilder(
  choice: RepeatingChoice,
  origin: ScheduleTriggerOrigin,
): ScheduleBuilderModel {
  const savedCron = choice === origin.choice ? origin.savedCron : null;
  const seed = (savedCron ? parseCron(savedCron) : origin.seed) ?? DEFAULT_BUILDER;
  const values: BuilderValues = {
    ...seed,
    repeats: choice === origin.choice ? seed.repeats : choice,
    endHour: seed.endHour ?? 18,
    month: seed.month ?? 1,
  };
  return savedCron && !isBuilderCron(savedCron)
    ? { kind: 'custom', cron: savedCron, values }
    : { kind: 'editing', values };
}

/** The trigger a choice opens, seeded from what the schedule opened with. */
export function triggerFor(
  choice: TriggerChoice | null,
  origin: ScheduleTriggerOrigin,
  onceValue = '',
): ScheduleTrigger {
  if (choice === null) return { kind: 'none' };
  if (choice === 'once') return { kind: 'once', value: onceValue };
  if (choice === 'event') return { kind: 'event', selection: null };
  return { kind: 'repeating', choice, builder: repeatingBuilder(choice, origin) };
}

/** The cron a repeating trigger saves; null when the builder cannot express its values. */
export function triggerCron(trigger: ScheduleTrigger): string | null {
  if (trigger.kind !== 'repeating') return null;
  return trigger.builder.kind === 'custom'
    ? trigger.builder.cron
    : buildCron(trigger.builder.values);
}

export function scheduleFormReducer(state: ScheduleTrigger, event: TriggerEvent): ScheduleTrigger {
  switch (event.type) {
    case 'choose':
      return triggerFor(event.choice, event.origin);
    case 'date':
      return state.kind === 'once' ? { ...state, value: event.value } : state;
    case 'edit':
      return state.kind === 'repeating'
        ? {
            ...state,
            builder: { kind: 'editing', values: { ...state.builder.values, ...event.values } },
          }
        : state;
    case 'event':
      return state.kind === 'event' ? { ...state, selection: event.value } : state;
  }
}
