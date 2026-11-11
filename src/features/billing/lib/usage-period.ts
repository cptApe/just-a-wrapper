export type UsagePeriodKey = 'cycle' | 'last' | 'custom';

const DAY_MS = 86_400_000;
// The stored reset is not a billing schedule; approximate the previous cycle as thirty days.
const LAST_CYCLE_DAYS = 30;
// Bound only chart buckets, not the headline total, and retain the most recent days.
export const MAX_DENSE_DAYS = 366;

export function lastCycleAvailable(creditResetAt: Date | null): boolean {
  return creditResetAt !== null;
}

function parseDayStart(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDayEnd(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function countDays(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((end - start) / DAY_MS) + 1;
}

export type ResolvedWindow = { from: Date; to: Date; period: UsagePeriodKey };

// Resolve one shared window for all views; invalid custom dates use the current cycle.
export function resolveUsageWindow(input: {
  period: UsagePeriodKey;
  from: string | null;
  to: string | null;
  creditResetAt: Date | null;
  workspaceCreatedAt: Date;
}): ResolvedWindow {
  const now = new Date();
  const { period, creditResetAt, workspaceCreatedAt } = input;

  if (period === 'last' && creditResetAt) {
    return {
      from: new Date(creditResetAt.getTime() - LAST_CYCLE_DAYS * DAY_MS),
      // The reset instant belongs to this cycle; stop the previous cycle before it to avoid double counting.
      to: new Date(creditResetAt.getTime() - 1),
      period: 'last',
    };
  }

  if (period === 'custom') {
    const from = parseDayStart(input.from);
    const to = parseDayEnd(input.to);
    if (from && to && from <= to) return { from, to, period: 'custom' };
  }

  return { from: creditResetAt ?? workspaceCreatedAt, to: now, period: 'cycle' };
}

// Calendar gaps must remain visible; zero-fill empty days instead of collapsing the chart.
export function densifyDays(
  sparse: ReadonlyArray<{ day: string; used: number }>,
  from: Date,
  to: Date,
): Array<{ day: string; used: number }> {
  const byDay = new Map(sparse.map((r) => [r.day, r.used]));
  const fromStart = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  const capStart = end - (MAX_DENSE_DAYS - 1) * DAY_MS;
  const start = Math.max(fromStart, capStart);
  const out: Array<{ day: string; used: number }> = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end) {
    const day = toDayString(cursor);
    out.push({ day, used: byDay.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
