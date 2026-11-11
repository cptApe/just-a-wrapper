import { type inferParserType, parseAsString, parseAsStringLiteral } from 'nuqs/server';
import { timeZoneInputSchema } from '@/features/preferences/lib/time-preferences';

/** URL refinements shared by the Tasks tab and both Runs views. */
export const scheduledParsers = {
  tab: parseAsStringLiteral(['tasks', 'runs'] as const).withDefault('tasks'),
  view: parseAsStringLiteral(['list', 'calendar'] as const).withDefault('list'),
  q: parseAsString.withDefault(''),
};

export type ScheduledTab = 'tasks' | 'runs';

/** Overlay links carry the viewer's zone; an unknown one falls back to the form's own default. */
export function parseScheduleTimezoneParam(value: string | null): string | null {
  return timeZoneInputSchema.catch(null).parse(value);
}

export function normalizeScheduledParams(
  params: inferParserType<typeof scheduledParsers>,
): inferParserType<typeof scheduledParsers> {
  return params.tab === 'tasks' ? { ...params, view: 'list' } : params;
}
