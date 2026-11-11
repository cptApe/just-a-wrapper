'use client';

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import type { WorkSheet } from 'xlsx';
import { IconDownload01 } from '@/components/icons';
import { useTheme } from '@/components/theme/theme-provider';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AppError } from '@/lib/errors';
import { formatBytes } from '@/lib/format/format-bytes';
import { captureException } from '@/lib/observability-client';
import {
  capSpreadsheetPreview,
  isBinaryPreviewTooLarge,
  MAX_BINARY_PREVIEW_BYTES,
} from '../lib/office-preview';
import { DataTable } from './data-table';
import { HtmlPreview } from './html-preview';
import { OfficePreviewSkeleton } from './office-preview-skeleton';
import { PptxSlidesPreview } from './pptx-slides-preview';
import { PreviewNotice } from './preview-notice';

type ParseState<T> =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'success'; value: T };

type SheetPreview = { name: string; rows: string[][]; truncated: boolean };

export function BinaryOfficePreview({
  kind,
  filename,
  url,
  queryKey,
  downloadHref,
  contentLengthBytes,
  enabled,
}: {
  kind: 'docx' | 'xlsx' | 'pptx';
  filename: string;
  url: string;
  queryKey: readonly unknown[];
  downloadHref: string;
  contentLengthBytes: number;
  enabled: boolean;
}) {
  const isTooLarge = isBinaryPreviewTooLarge(contentLengthBytes);
  const bytesQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchBytes(url, signal),
    enabled: enabled && !isTooLarge,
  });
  const download = <DownloadOfficeFile filename={filename} href={downloadHref} />;

  React.useEffect(() => {
    if (!bytesQuery.isError || isTooLargePreviewError(bytesQuery.error)) return;
    captureException(bytesQuery.error, { feature: 'artifacts', op: `${kind}-preview-download` });
  }, [bytesQuery.isError, bytesQuery.error, kind]);

  if (isTooLarge || isTooLargePreviewError(bytesQuery.error)) {
    return (
      <PreviewNotice
        title="Too large to preview"
        message={`${formatBytes(contentLengthBytes)}. Download the file to view it.`}
        action={download}
      />
    );
  }
  if (bytesQuery.isError) {
    return (
      <PreviewNotice
        title="Couldn’t load the preview"
        message="The file could not be downloaded for preview. Download it to open it instead."
        action={download}
      />
    );
  }
  if (bytesQuery.data === undefined) return <OfficePreviewSkeleton filename={filename} />;
  if (kind === 'pptx') {
    return <PptxSlidesPreview bytes={bytesQuery.data} filename={filename} download={download} />;
  }
  return kind === 'docx' ? (
    <DocxPreview bytes={bytesQuery.data} filename={filename} download={download} />
  ) : (
    <XlsxPreview bytes={bytesQuery.data} filename={filename} download={download} />
  );
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (cause) {
    throw new AppError('API_REQUEST_FAILED', 'Office preview download failed', { url }, { cause });
  }
  if (!response.ok) {
    throw new AppError('API_REQUEST_FAILED', 'Office preview download failed', {
      url,
      status: response.status,
    });
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && isBinaryPreviewTooLarge(contentLength)) {
    throw new AppError('VALIDATION_FAILED', 'Office preview exceeds the binary preview limit', {
      contentLength,
      maxBytes: MAX_BINARY_PREVIEW_BYTES,
      expected: true,
    });
  }
  return response.arrayBuffer();
}

function isTooLargePreviewError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.context.expected === true &&
    error.context.maxBytes === MAX_BINARY_PREVIEW_BYTES
  );
}

function DocxPreview({
  bytes,
  filename,
  download,
}: {
  bytes: ArrayBuffer;
  filename: string;
  download: React.ReactNode;
}) {
  const { theme } = useTheme();
  const [state, setState] = React.useState<ParseState<string>>({ kind: 'loading' });
  const [documentTheme, setDocumentTheme] = React.useState<DocumentTheme | null>(null);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setDocumentTheme(readDocumentTheme(theme)));
    return () => cancelAnimationFrame(frame);
  }, [theme]);

  React.useEffect(() => {
    let cancelled = false;
    import('mammoth')
      .then((mammoth) => mammoth.convertToHtml({ arrayBuffer: bytes.slice(0) }))
      .then((result) => {
        if (cancelled) return;
        const text = new DOMParser().parseFromString(result.value, 'text/html').body.textContent;
        setState(text.trim() ? { kind: 'success', value: result.value } : { kind: 'empty' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        captureException(error, { feature: 'artifacts', op: 'docx-preview-parse' });
        setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (state.kind === 'loading' || documentTheme === null) {
    return <OfficePreviewSkeleton filename={filename} />;
  }
  if (state.kind === 'empty') {
    return (
      <PreviewNotice title="This Word document is empty" message="There is no text to preview" />
    );
  }
  if (state.kind === 'error') {
    return (
      <PreviewNotice
        title="Couldn’t preview this Word document"
        message="The document could not be read. Download it to open it instead."
        action={download}
      />
    );
  }
  return <HtmlPreview html={documentHtml(state.value, documentTheme)} title={filename} />;
}

function XlsxPreview({
  bytes,
  filename,
  download,
}: {
  bytes: ArrayBuffer;
  filename: string;
  download: React.ReactNode;
}) {
  const [state, setState] = React.useState<
    ParseState<{ sheets: SheetPreview[]; firstSheet: SheetPreview }>
  >({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    import('xlsx')
      .then((XLSX) => {
        const workbook = XLSX.read(bytes.slice(0));
        const worksheets: Partial<Record<string, WorkSheet>> = workbook.Sheets;
        return workbook.SheetNames.map((name) => {
          const worksheet = worksheets[name];
          const rawRows: unknown = worksheet
            ? XLSX.utils.sheet_to_json(worksheet, {
                header: 1,
                raw: false,
                defval: '',
                blankrows: false,
              })
            : [];
          const preview = capSpreadsheetPreview(normalizeRows(rawRows));
          return {
            name,
            ...preview,
          };
        });
      })
      .then((sheets) => {
        if (cancelled) return;
        const firstSheet = sheets.at(0);
        setState(
          !firstSheet || sheets.every((sheet) => sheet.rows.length === 0)
            ? { kind: 'empty' }
            : { kind: 'success', value: { sheets, firstSheet } },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        captureException(error, { feature: 'artifacts', op: 'xlsx-preview-parse' });
        setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (state.kind === 'loading') return <OfficePreviewSkeleton filename={filename} />;
  if (state.kind === 'empty') {
    return (
      <PreviewNotice title="This spreadsheet is empty" message="There are no rows to preview" />
    );
  }
  if (state.kind === 'error') {
    return (
      <PreviewNotice
        title="Couldn’t preview this spreadsheet"
        message="The workbook could not be read. Download it to open it instead."
        action={download}
      />
    );
  }

  const { sheets, firstSheet } = state.value;
  return (
    <Tabs defaultValue={firstSheet.name} className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 overflow-x-auto overscroll-x-contain pb-1">
        <TabsList aria-label="Workbook sheets">
          {sheets.map((sheet) => (
            <TabsTrigger key={sheet.name} value={sheet.name}>
              {sheet.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {sheets.map((sheet) => (
        <TabsContent key={sheet.name} value={sheet.name} className="mt-2 min-h-0 overflow-auto">
          <DataTable
            rows={sheet.rows}
            emptyMessage="This sheet is empty"
            truncated={sheet.truncated}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function normalizeRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    return [row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)))];
  });
}

type DocumentTheme = {
  colorScheme: 'light' | 'dark';
  background: string;
  foreground: string;
  muted: string;
  border: string;
  link: string;
};

function readDocumentTheme(colorScheme: 'light' | 'dark'): DocumentTheme {
  const rootStyles = getComputedStyle(document.documentElement);
  return {
    colorScheme,
    background: resolveTokenColor(rootStyles, '--background'),
    foreground: resolveTokenColor(rootStyles, '--foreground'),
    muted: resolveTokenColor(rootStyles, '--muted-foreground'),
    border: resolveTokenColor(rootStyles, '--border'),
    link: resolveTokenColor(rootStyles, '--foreground'),
  };
}

function resolveTokenColor(rootStyles: CSSStyleDeclaration, token: string): string {
  const probe = document.createElement('span');
  probe.hidden = true;
  probe.style.color = rootStyles.getPropertyValue(token).trim();
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function documentHtml(content: string, theme: DocumentTheme): string {
  return `<style>
    html { color-scheme: ${theme.colorScheme}; background: ${theme.background}; color: ${theme.foreground}; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { box-sizing: border-box; max-width: 65ch; margin: 0 auto; padding: 40px 32px 64px; font-size: 15px; line-height: 1.55; }
    h1 { font-size: 2rem; line-height: 1.2; }
    h2 { font-size: 1.5rem; line-height: 1.25; }
    h3 { font-size: 1.2rem; line-height: 1.35; }
    h1, h2, h3 { margin: 1.5em 0 0.5em; text-wrap: balance; }
    p, ul, ol, table { margin: 0 0 1em; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid ${theme.border}; padding: 6px 8px; text-align: left; vertical-align: top; }
    small, figcaption { color: ${theme.muted}; }
    img { max-width: 100%; height: auto; }
    a { color: ${theme.link}; text-decoration: underline; }
  </style>${content}`;
}

function DownloadOfficeFile({ filename, href }: { filename: string; href: string }) {
  return (
    <Button asChild variant="secondary" size="xs">
      <a href={href} download={filename}>
        <IconDownload01 className="size-3.5" />
        Download
      </a>
    </Button>
  );
}
