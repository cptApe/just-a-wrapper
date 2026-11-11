// Only reject malformed cron locally; the deployment API owns cron semantics.

import { splitCron } from './split-cron';

const CRON_FIELD = /^[0-9*,/-]+$/;

/** True when `expression` is shaped like a 5-field POSIX cron. */
export function isFiveFieldCron(expression: string): boolean {
  const fields = splitCron(expression);
  return fields !== null && fields.every((f) => f.length > 0 && CRON_FIELD.test(f));
}

/**
 * True when `timezone` is a zone this runtime understands. Intl is the authority
 * here, NOT `Intl.supportedValuesOf('timeZone')`: that lists only CANONICAL zone
 * names, so it wrongly rejects IANA link aliases (Asia/Kolkata, Europe/Kyiv,
 * Asia/Yangon, America/Argentina/Buenos_Aires, …) — the very names browsers
 * report as `resolvedOptions().timeZone` and that the deployment API accepts.
 * `DateTimeFormat` resolves those aliases and throws `RangeError` on a genuinely
 * unknown id, so it accepts exactly the zones a real schedule can run in.
 */
export function isIanaTimezone(timezone: string): boolean {
  // Reject blank explicitly rather than depending on engine-specific handling
  // of timeZone:"". Case-variant ids (asia/kolkata) also resolve and are
  // accepted deliberately: real clients send properly-cased ids, and a
  // miscased one fails loudly at the deployment API instead of silently here.
  if (!timezone) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch (error) {
    // An unknown zone is invalid user input (→ false), not a failure to report.
    // Anything else is a real bug; rethrow so it is never swallowed.
    if (error instanceof RangeError) return false;
    throw error;
  }
}
