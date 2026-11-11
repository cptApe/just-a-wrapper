import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseEnv } from 'node:util';
import {
  anthropicApiKeySchema,
  databaseUrlSchema,
  parseSeededIds,
  setEnvValues,
} from '../../scripts/setup-env.ts';

const DATABASE_URL = 'postgres://owner:s3cretpass@db.example.test/app';
const API_KEY = 'sk-ant-test-key';
const SETUP_SCRIPT = resolve('scripts/setup.ts');
const SEED_OUTPUT = [
  'Paste these into .env for this deploy environment:',
  '  ANTHROPIC_ENVIRONMENT_ID=env_123',
  '  ANTHROPIC_AGENT_ID_FAST=agent_fast',
  '  ANTHROPIC_AGENT_ID_DEFAULT=agent_default',
  '  ANTHROPIC_AGENT_ID_PRO=agent_pro',
].join('\n');

// A stand-in for pnpm on PATH: the real script runs, nothing reaches a provider.
const FAKE_PNPM = `#!/bin/sh
echo "$2 db=$DATABASE_URL key=$ANTHROPIC_API_KEY" >> pnpm-calls.log
if [ "$2" = "$FAKE_FAIL" ]; then
  echo "connection to $DATABASE_URL failed with $ANTHROPIC_API_KEY" >&2
  exit 1
fi
if [ "$2" = "seed:agents" ]; then cat fake-seed-output.txt; fi
`;

function withProject(run) {
  const project = mkdtempSync(join(tmpdir(), 'setup-test-'));
  try {
    mkdirSync(join(project, 'bin'));
    writeFileSync(join(project, 'bin', 'pnpm'), FAKE_PNPM);
    chmodSync(join(project, 'bin', 'pnpm'), 0o755);
    writeFileSync(join(project, 'fake-seed-output.txt'), SEED_OUTPUT);
    copyFileSync('.env.example', join(project, '.env.example'));
    run(project);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

function runSetup(project, answers, env = {}) {
  const shell = { ...process.env };
  delete shell.DATABASE_URL;
  delete shell.DATABASE_URL_UNPOOLED;
  return spawnSync(process.execPath, ['--experimental-strip-types', SETUP_SCRIPT], {
    cwd: project,
    encoding: 'utf8',
    input: answers.map((answer) => `${answer}\n`).join(''),
    env: { ...shell, ...env, PATH: `${join(project, 'bin')}:${process.env.PATH}` },
  });
}

const envFile = (project) => parseEnv(readFileSync(join(project, '.env'), 'utf8'));
const pnpmCalls = (project) => readFileSync(join(project, 'pnpm-calls.log'), 'utf8');

test('setup refuses a database URL or API key that would not survive an unquoted .env file', () => {
  for (const url of [DATABASE_URL, 'postgresql://u@h/d?sslmode=require'])
    assert.equal(databaseUrlSchema.safeParse(url).success, true, url);
  for (const url of ['mysql://u@h/d', 'postgres://u:pa$$@h/d'])
    assert.equal(databaseUrlSchema.safeParse(url).success, false, url);
  assert.equal(anthropicApiKeySchema.safeParse(API_KEY).success, true);
  assert.equal(anthropicApiKeySchema.safeParse('').success, false);
  assert.equal(anthropicApiKeySchema.safeParse('sk ant').success, false);
});

test('writing .env replaces, uncomments and appends values without touching other lines', () => {
  const env = '# Comment about A\nA=old\n# B=\nKEEP=1\n';
  assert.equal(
    setEnvValues(env, { A: 'new', B: 'two', C: 'three' }),
    '# Comment about A\nA=new\nB=two\nKEEP=1\nC=three\n',
  );
  assert.equal(setEnvValues('# A=example\nA=old\n', { A: 'new' }), '# A=example\nA=new\n');
});

test('only the printed id block is read back from the agent seed', () => {
  assert.deepEqual(parseSeededIds(`Created agent\n${SEED_OUTPUT}\n\nDone.\n`), {
    ANTHROPIC_ENVIRONMENT_ID: 'env_123',
    ANTHROPIC_AGENT_ID_FAST: 'agent_fast',
    ANTHROPIC_AGENT_ID_DEFAULT: 'agent_default',
    ANTHROPIC_AGENT_ID_PRO: 'agent_pro',
  });
  assert.deepEqual(
    parseSeededIds('!!!   ANTHROPIC_AGENT_ID_FAST=(unset) but the agent is agent_fast'),
    {},
  );
});

test('first run writes .env, migrates, seeds and stores the seeded ids', () => {
  withProject((project) => {
    const run = runSetup(project, [DATABASE_URL, API_KEY]);
    assert.equal(run.status, 0, run.stderr);

    const env = envFile(project);
    assert.equal(env.DATABASE_URL, DATABASE_URL);
    assert.equal(env.ANTHROPIC_API_KEY, API_KEY);
    assert.equal(env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000');
    assert.equal(Buffer.from(env.BETTER_AUTH_SECRET, 'base64').length, 32);
    assert.equal(env.ANTHROPIC_ENVIRONMENT_ID, 'env_123');
    assert.equal(env.ANTHROPIC_AGENT_ID_PRO, 'agent_pro');
    assert.equal(statSync(join(project, '.env')).mode & 0o777, 0o600);

    assert.deepEqual(
      pnpmCalls(project).trim().split('\n'),
      ['db:migrate', 'seed:agents'].map((script) => `${script} db=${DATABASE_URL} key=${API_KEY}`),
    );
    for (const secret of [DATABASE_URL, API_KEY, env.BETTER_AUTH_SECRET]) {
      assert.equal(`${run.stdout}${run.stderr}`.includes(secret), false);
    }
    assert.match(run.stdout, /pnpm dev/);
  });
});

test('declining leaves an existing .env untouched and runs nothing', () => {
  withProject((project) => {
    writeFileSync(join(project, '.env'), 'DATABASE_URL=keep-me\n');
    const run = runSetup(project, ['n']);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(project, '.env'), 'utf8'), 'DATABASE_URL=keep-me\n');
    assert.throws(() => pnpmCalls(project), { code: 'ENOENT' });
  });
});

test('a re-run keeps secrets and other settings and asks only for what is missing', () => {
  withProject((project) => {
    writeFileSync(
      join(project, '.env'),
      `DATABASE_URL=${DATABASE_URL}\nBETTER_AUTH_SECRET=keep-this\nRESEND_API_KEY=re_mine\n`,
    );
    const run = runSetup(project, ['y', API_KEY]);
    assert.equal(run.status, 0, run.stderr);
    const first = envFile(project);
    assert.equal(first.BETTER_AUTH_SECRET, 'keep-this');
    assert.equal(first.RESEND_API_KEY, 're_mine');
    assert.equal(first.ANTHROPIC_API_KEY, API_KEY);

    const before = readFileSync(join(project, '.env'), 'utf8');
    assert.equal(runSetup(project, ['y']).status, 0);
    assert.equal(readFileSync(join(project, '.env'), 'utf8'), before);
  });
});

test('a failing step exits non-zero, hides secrets and keeps .env for the next run', () => {
  withProject((project) => {
    const run = runSetup(project, [DATABASE_URL, API_KEY], { FAKE_FAIL: 'db:migrate' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /\[hidden\]/);
    assert.equal(`${run.stdout}${run.stderr}`.includes('s3cretpass'), false);
    assert.equal(`${run.stdout}${run.stderr}`.includes(API_KEY), false);
    assert.equal(envFile(project).DATABASE_URL, DATABASE_URL);
    assert.equal(pnpmCalls(project).includes('seed:agents'), false);
  });
});

test('seed output without ids is an error rather than a silent success', () => {
  withProject((project) => {
    writeFileSync(join(project, 'fake-seed-output.txt'), 'Done.\n');
    const run = runSetup(project, [DATABASE_URL, API_KEY]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no agent IDs/);
  });
});
