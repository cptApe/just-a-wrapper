function escapeCell(value: string | number): string {
  const cell = String(value);
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string {
  return [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
}
