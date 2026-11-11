// Pure matching helpers shared by the server api (SQL pattern building) and
// the client menu (static-command matching). No React, no I/O.

/** Trim + collapse inner whitespace — the canonical query both sides match on. */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Escape LIKE/ILIKE wildcards so user input matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Case-insensitive substring match of a static command's title. */
export function matchesQuery(query: string, title: string): boolean {
  const q = normalizeQuery(query).toLowerCase();
  return q !== '' && title.toLowerCase().includes(q);
}
