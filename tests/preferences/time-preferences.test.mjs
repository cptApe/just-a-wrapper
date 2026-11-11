// Which zone and clock a person's dates and schedules use: their choice, then the browser's zone,
// then UTC, and every zone a browser reports, aliases included, is accepted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isValidTimeZone,
  localeFromAcceptLanguage,
  resolveEffectiveTimeZone,
  resolveTimeFormat,
} from '../../src/features/preferences/lib/time-preferences.ts';

test('every IANA zone and alias a browser reports is valid, and nothing else is', () => {
  for (const zone of [
    'UTC',
    'Europe/Vilnius',
    'Asia/Calcutta',
    'Asia/Kolkata',
    'Europe/Kyiv',
    'America/Argentina/Buenos_Aires',
  ])
    assert.equal(isValidTimeZone(zone), true, zone);
  for (const zone of ['', 'EST5EDT-nonsense', 'Mars/Olympus_Mons', 'GMT+3', 'not a zone'])
    assert.equal(isValidTimeZone(zone), false, zone);
});

test('the chosen zone wins, then the browser zone, then UTC with a warning for each bad stored value', () => {
  const never = { warn: () => assert.fail('a valid zone must not warn') };
  assert.equal(
    resolveEffectiveTimeZone({ timezone: 'Asia/Tokyo', browserTimezone: 'Europe/Vilnius' }, never),
    'Asia/Tokyo',
  );
  assert.equal(
    resolveEffectiveTimeZone({ timezone: null, browserTimezone: 'Europe/Vilnius' }, never),
    'Europe/Vilnius',
  );
  const warnings = [];
  assert.equal(
    resolveEffectiveTimeZone(
      { timezone: 'Mars/Olympus', browserTimezone: 'Moon/Tranquility' },
      { warn: (fields) => warnings.push(fields.invalidTimeZone) },
    ),
    'UTC',
  );
  assert.deepEqual(warnings, ['Mars/Olympus', 'Moon/Tranquility']);
});

test('the clock format is the setting, then the request locale hour cycle, then 12-hour', () => {
  for (const [timeFormat, locale, expected] of [
    ['24h', 'en-US', '24h'],
    ['12h', 'de-DE', '12h'],
    [null, 'en-US', '12h'],
    [null, 'en-GB', '24h'],
    [null, null, '12h'],
    ['bogus', 'en-GB', '24h'],
    [null, 'not a locale!', '12h'],
  ]) {
    assert.equal(resolveTimeFormat({ timeFormat, locale }), expected, `${timeFormat} ${locale}`);
  }
  assert.equal(localeFromAcceptLanguage('en-GB,en;q=0.9'), 'en-GB');
  assert.equal(localeFromAcceptLanguage('*'), null);
  assert.equal(localeFromAcceptLanguage(null), null);
});
