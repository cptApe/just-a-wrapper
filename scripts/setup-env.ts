import { z } from 'zod';

// Node's env parser cuts unquoted values at `#` and Next expands `$`, so setup
// accepts only values that read back unchanged when written without quotes.
const ENV_SAFE_VALUE = /^[^\s'"`$#\\]+$/;
const ENV_SAFE_MESSAGE =
  'Use no spaces, quotes, $, # or backslashes. Percent-encode them in a URL.';

export const databaseUrlSchema = z
  .url({
    protocol: /^postgres(ql)?$/,
    error: 'Enter a Postgres URL that starts with postgres:// or postgresql://.',
  })
  .regex(ENV_SAFE_VALUE, ENV_SAFE_MESSAGE);

export const anthropicApiKeySchema = z
  .string()
  .min(1, 'Enter your Anthropic API key.')
  .regex(ENV_SAFE_VALUE, ENV_SAFE_MESSAGE);

export function setEnvValues(envText: string, values: Record<string, string>): string {
  const lines = envText.split('\n');
  for (const [name, value] of Object.entries(values)) {
    const active = lines.findIndex((line) => line.startsWith(`${name}=`));
    const commented = lines.findIndex((line) => new RegExp(`^#\\s*${name}=`).test(line));
    const target = active === -1 ? commented : active;
    if (target === -1) {
      lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${name}=${value}`);
    } else {
      lines[target] = `${name}=${value}`;
    }
  }
  return lines.join('\n');
}

const SEEDED_ID_LINE = /^(ANTHROPIC_ENVIRONMENT_ID|ANTHROPIC_AGENT_ID_[A-Z0-9_]+)=\S+$/;

/** Reads the `NAME=id` block that `pnpm seed:agents` prints after a live run. */
export function parseSeededIds(seedOutput: string): Record<string, string> {
  const assignments = seedOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => SEEDED_ID_LINE.test(line))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    });
  return Object.fromEntries(assignments);
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length > 0)
    .reduce((redacted, secret) => redacted.replaceAll(secret, '[hidden]'), text);
}
