// Drizzle wraps the driver error, so the walk follows `cause`. `constraint` limits the match to one
// named unique index.
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ('code' in current && current.code === '23505') {
      return (
        constraint === undefined || ('constraint' in current && current.constraint === constraint)
      );
    }
  }
  return false;
}
