// Dates, times and money read the same for every reader in their own zone, whatever locale and
// zone the server host runs in. A wrong day or a wrong amount on screen misleads people.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  formatClock,
  formatDate,
  formatDateTime,
  formatZoneOffset,
  zonedDayKey,
} from '../../src/lib/format/format-date.ts';
import { formatMoney } from '../../src/lib/format/format-money.ts';
import { formatRelativeTime } from '../../src/lib/format/format-relative.ts';

const instant = new Date(Date.UTC(2026, 10, 10, 14, 5, 9));

test('dates and clocks use the reader zone, half-hour offsets included', () => {
  assert.equal(formatDate(instant, 'UTC'), 'Nov 10, 2026');
  assert.equal(formatDate(Date.UTC(2026, 10, 10, 20), 'Asia/Tokyo'), 'Nov 11, 2026');
  assert.equal(formatDate(Date.UTC(2026, 10, 10, 3), 'America/Los_Angeles'), 'Nov 9, 2026');
  assert.equal(formatDate('not a date', 'UTC'), '—');
  assert.equal(formatClock(instant, { timeZone: 'Asia/Kolkata', timeFormat: '12h' }), '7:35 PM');
  assert.equal(formatClock(instant, { timeZone: 'UTC', timeFormat: '24h' }), '14:05');
  assert.equal(formatZoneOffset('Asia/Kolkata', instant), 'GMT+5:30');
  assert.equal(zonedDayKey(Date.UTC(2026, 10, 10, 20), 'Asia/Tokyo'), '2026-11-11');
  assert.equal(zonedDayKey('nope', 'UTC'), null);
});

test('clocks move with daylight saving time, and an unknown zone reads as UTC', () => {
  const ny = { timeZone: 'America/New_York', timeFormat: '12h' };
  // 2026-03-08: New York moves from UTC-5 to UTC-4 at 07:00 UTC.
  assert.equal(formatClock(Date.UTC(2026, 2, 8, 6, 30), ny), '1:30 AM');
  assert.equal(formatClock(Date.UTC(2026, 2, 8, 7, 30), ny), '3:30 AM');
  assert.equal(formatClock(instant, { timeZone: 'Mars/Base', timeFormat: '24h' }), '14:05');
});

test('money is currency aware and never divides a zero-decimal currency by 100', () => {
  assert.equal(formatMoney(2000, 'usd'), '$20');
  assert.equal(formatMoney(123_450, 'USD'), '$1,234.50');
  assert.equal(formatMoney(1999, 'EUR'), '€19.99');
  assert.equal(formatMoney(1500, 'JPY'), '¥1,500');
});

test('a server host in another locale and zone still renders en-US in the reader zone', () => {
  const script = `
    const { toPaymentHistoryRow } = await import('./src/features/billing/lib/payment-history-row.ts');
    const { formatDateTime } = await import('./src/lib/format/format-date.ts');
    const { formatRelativeTime } = await import('./src/lib/format/format-relative.ts');
    const at = new Date(Date.UTC(2026, 10, 10, 14, 5));
    const row = toPaymentHistoryRow(
      { id: 'in_1', date: at, description: 'Top up', amountCents: 123450, currency: 'usd', receiptUrl: null },
      'America/New_York',
    );
    console.log(JSON.stringify({
      row,
      dateTime: formatDateTime(at, { timeZone: 'UTC', timeFormat: '12h' }),
      lastActive: formatRelativeTime(Date.UTC(2026, 9, 1), { now: at, timeZone: 'UTC' }),
    }));
  `;
  const out = execFileSync(
    process.execPath,
    ['--import', './scripts/register-aliases.mjs', '--input-type=module', '-e', script],
    {
      env: { ...process.env, LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8', TZ: 'Asia/Tokyo' },
      encoding: 'utf8',
    },
  );
  const result = JSON.parse(out.trim().split('\n').at(-1));
  assert.equal(result.row.dateLabel, 'Nov 10, 2026');
  assert.equal(result.row.amountLabel, '$1,234.50');
  assert.equal(result.dateTime, 'Nov 10, 2026, 2:05 PM');
  assert.equal(result.lastActive, 'Oct 1, 2026');
  // The same calls in this process agree.
  assert.equal(
    formatDateTime(Date.UTC(2026, 10, 10, 14, 5), { timeZone: 'UTC', timeFormat: '12h' }),
    result.dateTime,
  );
  assert.equal(
    formatRelativeTime(Date.UTC(2026, 9, 1), {
      now: Date.UTC(2026, 10, 10, 14, 5),
      timeZone: 'UTC',
    }),
    result.lastActive,
  );
});
