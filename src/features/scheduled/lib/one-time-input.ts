/** Wall-clock form value in the schedule's zone, independent of the browser zone. */
export function formatOneTimeInput(date: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Reject nonexistent daylight-saving times instead of silently moving the run. */
export function parseOneTimeInput(value: string, timezone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall)) return null;
  let instant = wall;
  for (let attempt = 0; attempt < 4; attempt++) {
    const rendered = Date.parse(`${formatOneTimeInput(new Date(instant), timezone)}:00Z`);
    instant += wall - rendered;
  }
  const runAt = new Date(instant);
  return formatOneTimeInput(runAt, timezone) === value ? runAt : null;
}
