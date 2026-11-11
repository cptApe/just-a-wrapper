import { AppError } from '@/lib/errors';

// The /app home greeting: time-of-day + first name + mild variation. Computed
// SERVER-side only and passed down as a plain string, so the client never
// recomputes it — that's what makes it hydration-safe (no Date.now() divergence
// between server and client renders).
//
// Time-of-day comes from the user's effective stored timezone. Missing or
// invalid input uses the time-agnostic variant rather than the server clock.

type Bucket = 'morning' | 'afternoon' | 'evening' | 'night' | 'neutral';

const TEMPLATES: Record<Bucket, string[]> = {
  morning: ['Good morning', 'Morning'],
  afternoon: ['Good afternoon', 'Hope your day’s going well'],
  evening: ['Good evening', 'Evening'],
  night: ['Burning the midnight oil', 'Up late'],
  neutral: ['Welcome back', 'Hello', 'Good to see you'],
};

function bucketForHour(hour: number): Bucket {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

/** Local hour (0-23) in `timeZone`, or null when the zone is missing/invalid. */
function localHour(now: Date, timeZone: string | null): number | null {
  if (!timeZone) return null;
  let hour: string;
  try {
    hour = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone,
    }).format(now);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  const parsed = Number.parseInt(hour, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Mild variation: rotate templates by day-of-year, deterministic per day. */
function pickTemplate(bucket: Bucket, now: Date): string {
  const templates = TEMPLATES[bucket];
  const dayOfYear = Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86_400_000);
  const template = templates.at(dayOfYear % templates.length);
  if (template === undefined)
    throw new AppError('UNEXPECTED', 'No greeting template for date', { bucket });
  return template;
}

export function buildGreeting(input: {
  name: string | null;
  now: Date;
  timeZone: string | null;
}): string {
  const hour = localHour(input.now, input.timeZone);
  const bucket = hour === null ? 'neutral' : bucketForHour(hour);
  const template = pickTemplate(bucket, input.now);
  const firstName = input.name?.trim().split(/\s+/)[0];
  return firstName ? `${template}, ${firstName}` : template;
}
