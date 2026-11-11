// The server next-run time is authoritative; this fills the display only until it is available.

import { parseCron } from '@/features/tasks/lib/build-cron';
import { zonedDateParts } from '@/features/tasks/lib/zoned-date-parts';

const DAY_MS = 86_400_000;

/** The UTC instant of a wall-clock time in a zone (two-pass offset fix). */
function zonedToUtc(timezone: string, y: number, m: number, d: number, h: number, mi: number) {
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i += 1) {
    const p = zonedDateParts(new Date(guess), timezone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += Date.UTC(y, m - 1, d, h, mi) - asUtc;
  }
  return guess;
}

const KNOWN_ZONES = new Set<string>(Intl.supportedValuesOf('timeZone'));

/** A zone this runtime knows, else UTC (an unknown zone must not throw here). */
function safeZone(timezone: string | null): string {
  return timezone && (KNOWN_ZONES.has(timezone) || timezone === 'UTC') ? timezone : 'UTC';
}

export function nextRunFromCron(cron: string, timezone: string | null, now: number): Date | null {
  const state = parseCron(cron);
  if (!state) return null;
  const { hour: hourRaw, minute: minuteRaw } = state.time;
  if (state.repeats === 'hourly') return null;
  const zone = safeZone(timezone);
  const today = zonedDateParts(new Date(now), zone);
  const start = Date.UTC(today.year, today.month - 1, today.day);
  for (let offset = 0; offset <= 400; offset += 1) {
    const probe = new Date(start + offset * DAY_MS);
    const y = probe.getUTCFullYear();
    const m = probe.getUTCMonth() + 1;
    const d = probe.getUTCDate();
    const weekday = probe.getUTCDay();
    const matches =
      state.repeats === 'daily' ||
      (state.repeats === 'weekly' && state.weekdays.some((w) => (w === 7 ? 0 : w) === weekday)) ||
      (state.repeats === 'monthly' && state.monthDays.includes(d)) ||
      (state.repeats === 'yearly' && (state.month ?? 1) === m && state.monthDays.includes(d));
    if (!matches) continue;
    const at = zonedToUtc(zone, y, m, d, hourRaw, minuteRaw);
    if (at > now) return new Date(at);
  }
  return null;
}
