export const MAX_BINARY_PREVIEW_BYTES = 20 * 1024 * 1024;
const XLSX_PREVIEW_MAX_ROWS = 500;
const XLSX_PREVIEW_MAX_COLUMNS = 50;

export function isBinaryPreviewTooLarge(contentLengthBytes: number): boolean {
  return contentLengthBytes > MAX_BINARY_PREVIEW_BYTES;
}

export function capSpreadsheetPreview(
  rows: readonly (readonly string[])[],
  options: { maxRows?: number; maxColumns?: number } = {},
): { rows: string[][]; truncated: boolean } {
  const maxRows = options.maxRows ?? XLSX_PREVIEW_MAX_ROWS;
  const maxColumns = options.maxColumns ?? XLSX_PREVIEW_MAX_COLUMNS;
  return {
    rows: rows.slice(0, maxRows).map((row) => row.slice(0, maxColumns)),
    truncated: rows.length > maxRows || rows.some((row) => row.length > maxColumns),
  };
}
