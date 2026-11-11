// Up to two uppercase initials from a name (falling back to the email), for
// avatar fallbacks (Members page, sidebar). Splits on whitespace, `@`, and `.`
// so "ada@acme.com" -> "AA" and "Ada Lovelace" -> "AL". Returns "?" when there
// is nothing to derive from.
export function initialsFrom(name: string | null | undefined, email: string): string {
  return (
    (name || email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s.at(0)?.toUpperCase())
      .join('') || '?'
  );
}
