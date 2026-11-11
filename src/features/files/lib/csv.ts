// Minimal RFC-4180-ish CSV parser for the ArtifactViewer's table preview. Pure
// and dependency-free (unit-tested under node --test). Handles quoted fields,
// escaped quotes (""), embedded commas/newlines, and CRLF. Deliberately NOT a
// general CSV library: previews are capped, and a malformed tail degrades to
// "whatever parsed" rather than throwing — a preview must never crash the card.

export type CsvPreview = {
  rows: string[][];
  /** True when row or column caps trimmed the preview. */
  truncated: boolean;
};

const CSV_PREVIEW_MAX_ROWS = 200;
const CSV_PREVIEW_MAX_COLUMNS = 30;

export function parseCsvPreview(
  text: string,
  caps: { maxRows?: number; maxColumns?: number } = {},
): CsvPreview {
  const maxRows = caps.maxRows ?? CSV_PREVIEW_MAX_ROWS;
  const maxColumns = caps.maxColumns ?? CSV_PREVIEW_MAX_COLUMNS;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let truncated = false;

  const pushField = () => {
    const didTruncate = row.length >= maxColumns;
    if (!didTruncate) row.push(field);
    field = '';
    return didTruncate;
  };
  const pushRow = () => {
    const didTruncate = pushField();
    // Skip rows that are entirely empty (trailing newline artifacts).
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
    return didTruncate;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === '') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      truncated = pushField() || truncated;
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      truncated = pushRow() || truncated;
      if (rows.length >= maxRows) {
        truncated ||= i < text.length - 1;
        return { rows, truncated: truncated };
      }
      continue;
    }
    field += char;
  }
  if (field !== '' || row.length > 0) truncated = pushRow() || truncated;
  return { rows, truncated: truncated };
}
