const PROBE_ORIGIN = 'https://internal.invalid';

/**
 * Whether a path-shaped href stays on this origin. Browsers read `/\\host` and
 * `//host` as another site, so the check resolves the href as a browser would.
 */
export function isSafeInternalHref(value: string): boolean {
  return (
    value.startsWith('/') &&
    URL.canParse(value, PROBE_ORIGIN) &&
    new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN
  );
}
