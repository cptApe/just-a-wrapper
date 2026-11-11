// The env registry behind /admin/environment, .env.example and the console's template download:
// every key the app reads is described truthfully, and no output ever carries a real value.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import '../support/env.mjs';
import {
  BRAND_ENV_KEYS,
  INLINED_PUBLIC_ENV_KEYS,
  PLATFORM_ENV_KEYS,
} from '../../eslint-rules/no-raw-env-read.mjs';
import { renderEnvExample } from '../../scripts/env-example.mjs';
import { ENV_REGISTRY } from '../../src/features/admin/environment/lib/env-registry.ts';

const { serverEnvShape, clientEnvShape } = await import('../../src/lib/env.ts');
const { requiredServerEnvShape, requiredClientEnvShape } = await import(
  '../../src/lib/env-schema.ts'
);
const { buildEnvTemplate } = await import(
  '../../src/features/admin/environment/lib/env-template.ts'
);

/** The default a schema fills in when the key is unset, as the registry prints it. */
function defaultOf(schema) {
  const parsed = schema.safeParse(undefined);
  return parsed.success && parsed.data !== undefined ? String(parsed.data) : undefined;
}

test('every key the app reads has exactly one row stating the scope, requiredness and default it really has', () => {
  const names = ENV_REGISTRY.map((key) => key.name);
  assert.equal(new Set(names).size, names.length, 'a key is listed twice');
  const registered = new Map(ENV_REGISTRY.map((key) => [key.name, key]));
  const declared = new Map();
  for (const [scope, shape, required] of [
    ['server', serverEnvShape, requiredServerEnvShape],
    ['client', clientEnvShape, requiredClientEnvShape],
  ])
    for (const [name, schema] of Object.entries(shape))
      declared.set(name, { scope, required: name in required, defaultValue: defaultOf(schema) });

  const wrong = [];
  for (const [name, info] of declared) {
    const row = registered.get(name);
    if (!row) wrong.push(`${name}: no row`);
    else if (
      row.scope !== info.scope ||
      row.required !== info.required ||
      row.defaultValue !== info.defaultValue
    )
      wrong.push(`${name}: row says ${row.scope}/${row.required}/${row.defaultValue}`);
  }
  for (const row of ENV_REGISTRY) {
    if (Boolean(row.outsideSchema) === declared.has(row.name))
      wrong.push(`${row.name}: outsideSchema is wrong`);
  }
  for (const name of [...INLINED_PUBLIC_ENV_KEYS, ...BRAND_ENV_KEYS])
    if (!registered.has(name)) wrong.push(`${name}: read raw but has no row`);
  for (const name of PLATFORM_ENV_KEYS)
    if (registered.has(name)) wrong.push(`${name}: platform keys are not operator configuration`);
  assert.deepEqual(wrong, []);
});

test('the committed .env.example is what the registry renders, and a copy of it boots the app', () => {
  const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  assert.equal(example, renderEnvExample(), 'Run pnpm env:example and commit .env.example');
  const keys = [...example.matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=.*$/gm)].map((match) => match[1]);
  assert.deepEqual(keys.sort(), ENV_REGISTRY.map((setting) => setting.name).sort());
  const started = spawnSync(
    process.execPath,
    [
      '--import',
      './scripts/register-aliases.mjs',
      '--input-type=module',
      '-e',
      "await import('./src/lib/env.ts')",
    ],
    {
      encoding: 'utf8',
      env: {
        ...parseEnv(example),
        PATH: process.env.PATH,
        DATABASE_URL: 'postgres://test:test@localhost/test',
        BETTER_AUTH_SECRET: 'x'.repeat(32),
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      },
    },
  );
  assert.equal(started.status, 0, started.stderr);
});

test('the console template lists every key once and never the value set in this process', () => {
  const saved = new Map(ENV_REGISTRY.map((key) => [key.name, process.env[key.name]]));
  try {
    for (const [index, key] of ENV_REGISTRY.entries())
      process.env[key.name] = `secret-${index}-${key.name}`;
    const output = buildEnvTemplate(ENV_REGISTRY.map((key) => ({ ...key, isSet: true })));
    const emitted = [...output.matchAll(/^# ([A-Z][A-Z0-9_]*)=$/gm)].map((match) => match[1]);
    assert.deepEqual(emitted.sort(), ENV_REGISTRY.map((key) => key.name).sort());
    for (const [index, key] of ENV_REGISTRY.entries())
      assert.equal(output.includes(`secret-${index}-${key.name}`), false, key.name);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
