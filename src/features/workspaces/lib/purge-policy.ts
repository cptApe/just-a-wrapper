const PURGE_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS);
}
