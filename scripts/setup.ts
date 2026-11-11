// One command from a fresh clone to a runnable app: `pnpm run setup`.
// `pnpm setup` is pnpm's own shell installer and never reaches this script.
// Re-running is safe: migrations and seeding are idempotent and secrets are kept.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import {
  anthropicApiKeySchema,
  databaseUrlSchema,
  parseSeededIds,
  redactSecrets,
  setEnvValues,
} from './setup-env.ts';

const ENV_FILE = '.env';
const ENV_TEMPLATE = '.env.example';
const LOCAL_APP_URL = 'http://localhost:3000';
const envValuesSchema = z.record(z.string(), z.string());

class SetupError extends Error {}

// Readline echoes through its output stream, so muting it hides pasted secrets.
function createPrompter() {
  let isMuted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!isMuted) process.stdout.write(chunk);
      done();
    },
  });
  const readline = createInterface({
    input: process.stdin,
    output,
    terminal: process.stdin.isTTY,
  });
  // The iterator buffers lines, so answers piped in ahead of a prompt are kept.
  const lines = readline[Symbol.asyncIterator]();

  async function read(question: string, hidden: boolean): Promise<string> {
    process.stdout.write(question);
    isMuted = hidden;
    const line = await lines.next();
    isMuted = false;
    if (hidden) process.stdout.write('\n');
    if (line.done) throw new SetupError('Setup stopped before it got an answer.');
    return line.value.trim();
  }

  return {
    confirm: async (question: string) => /^y(es)?$/i.test(await read(`${question} (y/N) `, false)),
    askSecret: async (question: string, schema: z.ZodType<string>) => {
      for (;;) {
        const answer = schema.safeParse(await read(`${question} (input hidden): `, true));
        if (answer.success) return answer.data;
        console.log(answer.error.issues[0]?.message);
      }
    },
    close: () => readline.close(),
  };
}

function runPackageScript(script: string, env: NodeJS.ProcessEnv, secrets: string[]): string {
  const run = spawnSync('pnpm', ['run', script], { env, encoding: 'utf8' });
  if (run.status !== 0) {
    const output = `${run.stdout}\n${run.stderr}\n${run.error?.message ?? ''}`;
    console.error(redactSecrets(output, secrets));
    throw new SetupError(
      `pnpm run ${script} failed. Fix the problem above, then run pnpm run setup again.`,
    );
  }
  return run.stdout;
}

function saveEnvFile(envText: string): void {
  writeFileSync(ENV_FILE, envText, { mode: 0o600 });
}

async function main(): Promise<void> {
  const prompter = createPrompter();
  try {
    const existingEnv = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : null;
    if (
      existingEnv !== null &&
      !(await prompter.confirm(`${ENV_FILE} already exists. Keep its values and finish setup?`))
    ) {
      console.log(`Stopped. ${ENV_FILE} is unchanged.`);
      return;
    }

    const current = envValuesSchema.parse(parseEnv(existingEnv ?? ''));
    const databaseUrl =
      current.DATABASE_URL || (await prompter.askSecret('Neon database URL', databaseUrlSchema));
    const anthropicApiKey =
      current.ANTHROPIC_API_KEY ||
      (await prompter.askSecret('Anthropic API key', anthropicApiKeySchema));
    const authSecret = current.BETTER_AUTH_SECRET || randomBytes(32).toString('base64');
    // A value kept from an existing .env may not parse, and URL errors quote their input.
    const databasePassword = URL.canParse(databaseUrl) ? new URL(databaseUrl).password : '';
    const secrets = [databaseUrl, databasePassword, anthropicApiKey, authSecret];

    const configuredEnv = setEnvValues(existingEnv ?? readFileSync(ENV_TEMPLATE, 'utf8'), {
      DATABASE_URL: databaseUrl,
      ANTHROPIC_API_KEY: anthropicApiKey,
      BETTER_AUTH_SECRET: authSecret,
      NEXT_PUBLIC_APP_URL: current.NEXT_PUBLIC_APP_URL || LOCAL_APP_URL,
    });
    saveEnvFile(configuredEnv);
    console.log(`Saved ${ENV_FILE}.`);

    // Node's env-file loader never replaces a variable the shell already set,
    // so the saved file is passed explicitly to keep it the single source.
    const childEnv = {
      ...process.env,
      DATABASE_URL_UNPOOLED: undefined,
      ...envValuesSchema.parse(parseEnv(configuredEnv)),
    };

    console.log('Applying database migrations.');
    runPackageScript('db:migrate', childEnv, secrets);

    console.log('Creating agents on your Anthropic account.');
    const seededIds = parseSeededIds(runPackageScript('seed:agents', childEnv, secrets));
    if (!seededIds.ANTHROPIC_ENVIRONMENT_ID || Object.keys(seededIds).length < 2) {
      throw new SetupError('Seeding finished but printed no agent IDs. Run pnpm seed:agents.');
    }
    saveEnvFile(setEnvValues(configuredEnv, seededIds));

    console.log(`\nSetup is done. Start the app with:\n\n  pnpm dev\n`);
    console.log('Sign in with your email. The sign-in code appears in the pnpm dev log.');
  } finally {
    prompter.close();
  }
}

main().catch((error: unknown) => {
  // Script boundary: an expected stop is a plain sentence, anything else keeps its stack.
  process.exitCode = 1;
  if (error instanceof SetupError) {
    console.error(error.message);
    return;
  }
  throw error;
});
