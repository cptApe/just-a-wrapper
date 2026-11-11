'use client';

import { createElement } from 'react';
import {
  type Icon,
  IconFile02,
  IconFile04,
  IconFileCode01,
  IconGlobe01,
  IconImage01,
  IconMusicNote01,
  IconPackage,
  IconPlayCircle,
  IconPresentationChart01,
  IconTable,
} from '@/components/icons';
import { cn } from '@/lib/utils';
import { type FileKind, fileKind } from '../lib/file-types';

/** The colour family a file glyph paints in, from the `--file-*` tokens. Null keeps it muted. */
export type FileGlyphTone = 'pdf' | 'document' | 'sheet' | 'slides' | 'code' | 'image' | 'audio';

// One glyph and one colour family per kind, drawn the same in chat, the Library, the task-files
// overlay and the share page. Archives and unknown files stay muted: their glyph carries the kind.
const FILE_KIND_LOOKS: Record<FileKind, { glyph: Icon; tone: FileGlyphTone | null }> = {
  image: { glyph: IconImage01, tone: 'image' },
  video: { glyph: IconPlayCircle, tone: 'image' },
  audio: { glyph: IconMusicNote01, tone: 'audio' },
  pdf: { glyph: IconFile04, tone: 'pdf' },
  document: { glyph: IconFile02, tone: 'document' },
  presentation: { glyph: IconPresentationChart01, tone: 'slides' },
  spreadsheet: { glyph: IconTable, tone: 'sheet' },
  code: { glyph: IconFileCode01, tone: 'code' },
  html: { glyph: IconGlobe01, tone: 'code' },
  archive: { glyph: IconPackage, tone: null },
  file: { glyph: IconFile02, tone: null },
};

// Only the glyph is tinted; tiles, rows and selection keep their neutral fills.
const TONE_CLASSES: Record<FileGlyphTone, string> = {
  pdf: 'text-file-pdf',
  document: 'text-file-document',
  sheet: 'text-file-sheet',
  slides: 'text-file-slides',
  code: 'text-file-code',
  image: 'text-file-image',
  audio: 'text-file-audio',
};

/** The glyph for a file. */
export function fileKindGlyph(mimeType: string, name = ''): Icon {
  return FILE_KIND_LOOKS[fileKind(mimeType, name)].glyph;
}

/** The colour family for a file; null for kinds without one. */
export function fileGlyphTone(mimeType: string, name = ''): FileGlyphTone | null {
  return FILE_KIND_LOOKS[fileKind(mimeType, name)].tone;
}

/** A glyph's classes: its size plus its tone, or the muted colour for folders and unknown files. */
export function glyphClassName(
  tone: FileGlyphTone | null | undefined,
  sizeClassName: string,
): string {
  return cn(sizeClassName, tone ? TONE_CLASSES[tone] : 'text-muted-foreground');
}

/** A file's glyph in its kind's tint; the caller gives the size. */
export function FileKindIcon({
  mimeType,
  name,
  className,
}: {
  mimeType: string;
  name?: string;
  className?: string;
}) {
  // createElement over <Glyph/>: the component is selected from a table, not created, per render,
  // but the static-components lint cannot see that through a local.
  return createElement(fileKindGlyph(mimeType, name), {
    className: cn('shrink-0', glyphClassName(fileGlyphTone(mimeType, name), ''), className),
    'aria-hidden': true,
  });
}
