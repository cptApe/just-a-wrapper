import { type AnyColumn, type SQL, sql } from 'drizzle-orm';

// Escape LIKE/ILIKE wildcards (`\` `%` `_`) so a value is matched literally, both
// in search input ("100%") and in folder segments that may contain `_` or `%`.
// Relies on Postgres' default LIKE escape character (backslash).
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** True when the path column is `path` itself or a descendant of it. */
export function insidePath(column: AnyColumn, path: string): SQL {
  return sql`(${column} = ${path} or ${column} like ${`${escapeLike(path)}/%`})`;
}
