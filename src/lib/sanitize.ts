// Shared sink policy. Drop oversized strings before scanning so both work and
// output stay bounded, and never retain a partial credential at a cutoff.
const REDACTED = '[Redacted]';
const MAX_STRING = 4096;
const MAX_DEPTH = 8;
const MAX_NODES = 512;
const MAX_ENTRIES = 64;
// `params` holds SQL bound values on query errors, which include session tokens.
const SENSITIVE_KEY =
  /email$|^otp$|url$|inviteLink|pass(word)?|secret|token|api[_-]?key|authorization|cookie|ssn|credit.?card|^params$/i;
const PATTERNS = [
  // Query errors end their message with a `params:` line. A bound value can
  // contain newlines, so everything after the label goes.
  /(?<![^\n])params:[\s\S]*/g,
  // Only URLs that can carry credentials (query, fragment or userinfo). Plain
  // locations such as file:// stack frames stay readable.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`?#]*[?#@][^\s<>"'`]*/gi,
  /\b[^\s@<>"']+@[^\s@<>"']+/g,
  /\bBearer\s+[^\s,;]+/gi,
  /\b(?:sk|pk|rk|ghp|gho|xoxb|xoxp)[_-][a-z0-9_-]{12,}/gi,
  /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/gi,
  /\b(?:password|secret|token|api[_-]?key|signature|otp)\s*[=:]\s*[^\s&#,;]+/gi,
];

export function sanitizeString(value: string): string {
  if (value.length > MAX_STRING) return REDACTED;
  return PATTERNS.reduce((text, pattern) => text.replace(pattern, REDACTED), value);
}

// A sink that keeps only a sample (the session event mirror) cuts strings after redacting, so a
// credential that crosses the cut is already gone.
type SanitizeOptions = { truncateAt?: number };

function truncate(text: string, limit: number | undefined): string {
  if (limit === undefined || text.length <= limit) return text;
  return `${text.slice(0, limit)}…[+${text.length - limit} chars]`;
}

/** JSON-safe, non-mutating, bounded traversal, including native Error causes. */
export function sanitize(
  value: Record<string, unknown> | Error,
  options?: SanitizeOptions,
): Record<string, unknown>;
export function sanitize(value: unknown, options?: SanitizeOptions): unknown;
export function sanitize(value: unknown, { truncateAt }: SanitizeOptions = {}): unknown {
  let remaining = MAX_NODES;
  const seen = new WeakSet<object>();
  function visit(input: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > MAX_DEPTH) return REDACTED;
    if (typeof input === 'string') return truncate(sanitizeString(input), truncateAt);
    if (input == null || typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input !== 'object' || seen.has(input)) return REDACTED;
    seen.add(input);
    if (Array.isArray(input)) {
      const output = input.slice(0, MAX_ENTRIES).map((item) => visit(item, depth + 1));
      if (input.length > MAX_ENTRIES) output.push(REDACTED);
      return output;
    }
    if (input instanceof URL) return REDACTED;
    const output: Record<string, unknown> = {};
    function field(key: string, item: unknown): void {
      Object.defineProperty(output, sanitizeString(key), {
        value: SENSITIVE_KEY.test(key) ? REDACTED : visit(item, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (input instanceof Error) {
      field('name', input.name);
      field('message', input.message);
      // The stack repeats the message. Redacting it in place keeps the frames.
      field(
        'stack',
        input.stack?.replace(input.message, () => sanitizeString(input.message)),
      );
      if (input.cause !== undefined) field('cause', input.cause);
      if (input instanceof AggregateError) field('errors', input.errors);
    }
    let count = 0;
    for (const key in input) {
      if (!Object.hasOwn(input, key) || Object.hasOwn(output, key)) continue;
      if (++count > MAX_ENTRIES || remaining <= 0) {
        output.truncated = REDACTED;
        break;
      }
      // Do not invoke getters or toJSON methods supplied by logged objects.
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      field(key, descriptor && 'value' in descriptor ? descriptor.value : REDACTED);
    }
    return output;
  }
  return visit(value, 0);
}
