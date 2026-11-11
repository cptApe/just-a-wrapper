// The operator console's status board never shows green for a check that did not run, and says
// which command fixes what it finds.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KIT_VERSION } from '../../content/changelog.ts';
import {
  probeResultForError,
  UNDEFINED_TABLE,
} from '../../src/features/admin/overview/lib/database-probe-result.ts';
import {
  agentsRow,
  anthropicKeyRow,
  billingRow,
  databaseRow,
  migrationsRow,
  requiredEnvRow,
  themeRow,
  versionRow,
} from '../../src/features/admin/overview/lib/overview-rows.ts';

test('a check that could not run is never green', () => {
  for (const row of [
    databaseRow({ kind: 'unknown' }),
    migrationsRow({ kind: 'unknown' }),
    agentsRow({ isSeeded: true, driftKinds: ['in-sync', 'unknown', 'in-sync'] }),
    agentsRow({ isSeeded: true, driftKinds: [] }),
    billingRow({ status: 'unavailable' }),
    versionRow('unknown'),
    themeRow(null),
  ]) {
    assert.equal(row.tone, 'quiet', row.name);
  }
});

test('a database with no tables is connected but unmigrated; any other failure says nothing of the schema', () => {
  const missing = Object.assign(new Error('relation "workspace" does not exist'), {
    code: UNDEFINED_TABLE,
  });
  const probe = probeResultForError(missing);
  assert.deepEqual(probe, { kind: 'no-schema' });
  assert.equal(databaseRow(probe).status, 'Connected');
  assert.equal(migrationsRow(probe).tone, 'attention');
  assert.match(migrationsRow(probe).status, /pnpm db:migrate/);
  for (const other of [
    Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('permission denied'), { code: '42501' }),
    { code: 42501 },
    'a thrown string',
    null,
  ]) {
    assert.deepEqual(probeResultForError(other), { kind: 'unknown' });
  }
});

test('missing setup that breaks the app needs attention and names its fix', () => {
  const env = {
    total: 5,
    invalidServerKeys: ['DATABASE_URL'],
    invalidClientKeys: ['NEXT_PUBLIC_APP_URL'],
  };
  assert.equal(requiredEnvRow(env).tone, 'attention');
  assert.equal(requiredEnvRow(env).status, 'Missing DATABASE_URL');
  assert.equal(anthropicKeyRow(false).tone, 'attention');
  const unseeded = agentsRow({ isSeeded: false, driftKinds: ['in-sync', 'in-sync', 'in-sync'] });
  assert.equal(unseeded.tone, 'attention');
  assert.match(unseeded.status, /pnpm seed:agents/);
  const drifted = agentsRow({ isSeeded: true, driftKinds: ['in-sync', 'drifted', 'unknown'] });
  assert.match(drifted.status, /1 of 3 out of date/);
  assert.equal(billingRow({ status: 'not-seeded', intendedCount: 66 }).tone, 'attention');
  assert.match(
    billingRow({ status: 'differs', intendedCount: 66, issues: [{}] }).status,
    /1 difference/,
  );
  assert.equal(versionRow('0.0.1').tone, 'attention');
  assert.equal(versionRow(KIT_VERSION).tone, 'ready');
});
