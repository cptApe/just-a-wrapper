import { z } from 'zod';
import { AppError } from '@/lib/errors';

const formatters = new Map<string, Intl.DateTimeFormat>();

const numericPart = z.string().regex(/^\d+$/).transform(Number);
const partsSchema = z.object({
  year: numericPart,
  month: numericPart,
  day: numericPart,
  hour: numericPart,
  minute: numericPart,
});
export function zonedDateParts(date: Date, timezone: string) {
  try {
    let formatter = formatters.get(timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
      });
      formatters.set(timezone, formatter);
    }
    return partsSchema.parse(
      Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value])),
    );
  } catch (cause) {
    throw new AppError(
      'TOOL_INPUT_INVALID',
      'Could not resolve the scheduled date in this timezone',
      { timezone },
      { cause },
    );
  }
}
