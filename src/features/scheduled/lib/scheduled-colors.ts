import { type CalendarEvent, calendarEventStatus } from './calendar-events';

export const SCHEDULED_STATUS_COLORS = {
  succeeded: 'text-schedule-green',
  failed: 'text-schedule-red',
  stopped: 'text-schedule-violet',
  out_of_credits: 'text-schedule-orange',
  tool_gate: 'text-schedule-blue',
};

export function calendarEventColors(event: CalendarEvent) {
  if (event.kind === 'attention')
    return 'bg-schedule-orange/10 text-schedule-orange! hover:bg-schedule-orange/20';
  const status = calendarEventStatus(event);
  if (status === 'failed') return 'bg-schedule-red/10 text-schedule-red! hover:bg-schedule-red/20';
  if (status === 'stopped')
    return 'bg-schedule-violet/10 text-schedule-violet! hover:bg-schedule-violet/20';
  if (status === 'succeeded')
    return 'bg-schedule-emerald/10 text-schedule-emerald! hover:bg-schedule-emerald/20';
  return 'bg-schedule-blue/10 text-schedule-blue! hover:bg-schedule-blue/20';
}
