# One way to format dates, times, numbers and sizes

- **Status:** Accepted
- **Date:** November 2026

## Context

Dates, times, numbers and sizes were formatted five different ways. Chat and notifications used day-first dates and a 24-hour clock; Files, Scheduled and Billing used month-first dates and a 12-hour clock. Members showed `11/10/2026`, the workspace plan line `November 10, 2026`, and payment history whatever locale the server host ran in. File sizes had three helpers that disagreed (`2 KB` against `1.5 KB`, `2.0 MB` against `2 MB`). Relative times had two versions, one rounding and one flooring.

Client components formatted dates without a zone, so the server render used the server's zone and the browser then changed the text on hydration.

Settings → General → Time format saved a value nothing read. The owner ruled that every control either does what it says or is gone.

## Decision

- **`src/lib/format/` is the only place that formats a value for a person to read.** One locale, `en-US`. The shapes:
  - date `Nov 10, 2026`; short date `Nov 10`; compact date `Nov 10` this year, `Nov 10, 2025` otherwise;
  - date and time `Nov 10, 2026, 2:05 PM`; clock `2:05 PM` or `14:05`; hour chips `2 PM` or `14:00`;
  - relative `Just now`, `5m ago`, `3h ago`, `2d ago`, rounding down, then the date after a week;
  - duration `2 minutes`; timer `1:35`; size `1.5 KB`, `2 MB`; counts `12,345`;
  - money `$20`, `$1,234.50`; percent `95.3%` (the caller picks the decimals); plural `1 file`, `2 files`.
- **The zone and the clock reach every formatter the same way.** A formatter that shows an instant takes the zone, and a clock takes the time format, as plain values (`DisplayFormat = { timeZone, timeFormat }`). On the server a page reads them with `getDisplayPreferences(headers)`. In the browser `useDisplayFormat()` reads them from `DisplayFormatProvider`, which the `/app` layout fills from the same function, so the first paint and hydration agree. Signed-out surfaces (a public share page, the admin console on loopback) get UTC and the 12-hour clock. No formatter reads the runtime's locale or zone; an unknown zone formats in UTC.
- **Calendar days and wall-clock times have no zone.** A picked day, a release date or a schedule's `9:00` is formatted as it is, so no zone moves it.
- **The Time format setting is real.** Every clock in the app follows it, and so does the schedule time picker: a 0 to 23 hour field for 24-hour time, a 1 to 12 hour field with AM/PM for 12-hour time. Unset, it follows the locale's hour cycle, the same rule its own preview uses. Saving it or the time zone refreshes the layout so the whole app follows. The Time zone helper says "Used for dates and times across" the brand name, because the zone drives every date.
- **Text the agent reads keeps its wording.** The prompt's current-time line and the schedule tools' descriptions call the shared helpers only where the output is the same byte for byte. `scheduleLabel` in `src/features/tasks/lib/schedule-label.ts` is the one labeler for when a task runs: a person gets the short cadence in their time format, and the agent's schedule tools get the fixed wording.
- **Machine strings stay machine strings.** ISO strings for `<time dateTime>`, APIs and CSV, day keys, schedule zone math and CSS values do not go through the display helpers.
- **A lint rule holds the line.** `just-a-wrapper/no-raw-intl-format` fails on `Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.RelativeTimeFormat` and `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString` outside `src/lib/format/`. The allowlist in `eslint.config.mjs` names the files that use `Intl` for zone math, validation or a locale probe, each with a reason.

## Why

One module makes the same value read the same everywhere and leaves one place to change a shape. Passing the zone and the clock as values keeps `src/lib` free of features and makes the server render and the browser agree. A rule is the only thing that keeps a new screen from adding a sixth way.

## Consequences

- A new screen formats through `src/lib/format/` and reads the zone and clock from `useDisplayFormat()` or `getDisplayPreferences`.
- The Usage page keeps its UTC day buckets, so its log clock is UTC in the reader's time format.
- The admin analytics "synced" time stays UTC and 12-hour, because the same sentence feeds the admin markdown an agent reads.
- A new shape is a new function in `src/lib/format/` with a test, not a local formatter.
