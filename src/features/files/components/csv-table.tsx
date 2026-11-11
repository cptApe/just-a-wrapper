'use client';

import { useMemo } from 'react';
import { parseCsvPreview } from '../lib/csv';
import { DataTable } from './data-table';

// Simple table preview for CSV artifacts: first row as header, capped rows /
// columns (lib/csv.ts), with a visible truncation note.

export function CsvTable({ text }: { text: string }) {
  const preview = useMemo(() => parseCsvPreview(text), [text]);

  return (
    <DataTable
      rows={preview.rows}
      emptyMessage="This CSV file is empty"
      truncated={preview.truncated}
    />
  );
}
