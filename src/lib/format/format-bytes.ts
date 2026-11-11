const UNITS = ['KB', 'MB', 'GB', 'TB'];

/**
 * "512 B", "1.5 KB", "2 MB", "3.1 GB". Binary (1024) units, the convention file managers use.
 * One decimal unless the value is whole or 100 and up. "—" for a value that is not a size.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}
