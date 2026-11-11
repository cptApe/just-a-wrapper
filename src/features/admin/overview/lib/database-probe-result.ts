import type { DatabaseProbe } from '../types';

// Importing the probe opens a connection pool, so the one judgement it makes
// lives here where the test runner can load it.

/** Postgres undefined_table: the database answered and has not been migrated. */
export const UNDEFINED_TABLE = '42P01';

/** The driver puts the Postgres SQLSTATE on `code`. Anything without one (a
    socket hang-up, a DNS failure) is not a Postgres answer. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export function probeResultForError(error: unknown): DatabaseProbe {
  return errorCode(error) === UNDEFINED_TABLE ? { kind: 'no-schema' } : { kind: 'unknown' };
}
