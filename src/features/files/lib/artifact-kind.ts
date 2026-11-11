// Which viewer renders a file. What kind of file it is comes from file-types.ts; this module only
// splits that answer into the renderers the viewer has.

import type { ArtifactKind } from '../types';
import { baseMime, CODE_LANGUAGES, CODE_MIME_LANGUAGES, fileExtension } from './file-types';

// Text previews load the whole body into memory; past this size both viewers offer a download
// instead of stalling the tab. Hover prefetch reads the same cap from here without loading a viewer.
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

/**
 * Decide how the viewer renders an artifact. Mime type leads; the filename
 * extension breaks ties for the generic types agents actually emit
 * (`text/plain` for a .md, `application/octet-stream` for a .csv, …).
 */
export function classifyArtifact(mimeType: string, filename: string): ArtifactKind {
  const mime = baseMime(mimeType);
  const ext = fileExtension(filename);

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return 'docx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ext === 'xlsx'
  ) {
    return 'xlsx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === 'pptx'
  ) {
    return 'pptx';
  }

  if (mime === 'text/html' || mime === 'application/xhtml+xml' || ext === 'html' || ext === 'htm') {
    return 'html';
  }
  if (mime === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown';
  if (mime === 'text/csv' || ext === 'csv') return 'csv';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a'].includes(ext)) return 'audio';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  // SVG renders via <img> (scripts never run in an image context); other
  // image/* render natively.
  if (mime.startsWith('image/')) return 'image';
  // Plain text has no renderer of its own, so it opens in the code view without highlighting.
  if (CODE_MIME_LANGUAGES[mime] !== undefined || CODE_LANGUAGES[ext] !== undefined) return 'code';
  if (mime === 'text/plain' || ext === 'txt') return 'code';
  return 'unknown';
}

/** Shiki language hint for the code view ('' = plain text). */
export function codeLanguage(mimeType: string, filename: string): string {
  return CODE_LANGUAGES[fileExtension(filename)] ?? CODE_MIME_LANGUAGES[baseMime(mimeType)] ?? '';
}

/**
 * Wrap raw code in a markdown fence MarkdownMessage can render through the
 * existing Shiki pipeline. The fence is one backtick longer than the longest
 * backtick run in the content, so embedded ``` can never close it early.
 */
export function fenceCode(content: string, language: string): string {
  const longestRun = content.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}
