'use client';

import type { ReactNode } from 'react';
import { MarkdownMessage } from '@/components/ui/markdown-message';
import { codeLanguage, fenceCode } from '../lib/artifact-kind';
import { CsvTable } from './csv-table';
import { HtmlPreview } from './html-preview';

export type TextFileKind = 'markdown' | 'code' | 'csv' | 'html';

// The one identical decision shared by stored files and generated artifacts:
// turn loaded text into its four supported content formats. Storage, loading,
// errors, size limits, download actions, and framing stay with each adapter.
export function TextFileContent({
  filename,
  mimeType,
  kind,
  text,
}: {
  filename: string;
  mimeType: string;
  kind: TextFileKind;
  text: string;
}): ReactNode {
  switch (kind) {
    case 'html':
      return <HtmlPreview html={text} title={filename} />;
    case 'csv':
      return <CsvTable text={text} />;
    case 'markdown':
      return <MarkdownMessage text={text} />;
    case 'code':
      return <MarkdownMessage text={fenceCode(text, codeLanguage(mimeType, filename))} />;
  }
}
