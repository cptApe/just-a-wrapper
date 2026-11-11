// What kind of file a name and mime type describe, for every surface: chat, Library, task files,
// share page and viewer. Also the Library's type facets, which the SQL facets build from these lists.

export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'presentation'
  | 'spreadsheet'
  | 'code'
  | 'html'
  | 'archive'
  | 'file';

/** The Files tab's funnel type facets. */
export type TypeFacet = 'images' | 'documents' | 'spreadsheets' | 'presentations' | 'pdfs';

export const TYPE_FACETS: readonly TypeFacet[] = [
  'images',
  'documents',
  'spreadsheets',
  'presentations',
  'pdfs',
];

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const DOCUMENT_EXTENSIONS = new Set([
  'doc',
  'docx',
  'markdown',
  'md',
  'odt',
  'pages',
  'rtf',
  'txt',
]);
const ARCHIVE_EXTENSIONS = new Set(['7z', 'gz', 'rar', 'tar', 'tgz', 'zip']);
export const SPREADSHEET_EXTENSIONS = ['csv', 'numbers', 'ods', 'tsv', 'xls', 'xlsx'] as const;
export const PRESENTATION_EXTENSIONS = ['key', 'odp', 'ppt', 'pptx'] as const;
export const SPREADSHEET_MIME_HINTS = ['spreadsheet', 'ms-excel', 'csv', 'tab-separated'] as const;
export const PRESENTATION_MIME_HINTS = ['presentation', 'ms-powerpoint'] as const;
const DOCUMENT_MIME_HINTS = ['wordprocessingml', 'msword', 'rtf', 'markdown', 'opendocument.text'];
const ARCHIVE_MIME_HINTS = ['zip', 'tar', 'gzip', 'x-7z', 'x-rar', 'compressed'];

/** Code extensions and the Shiki language each renders with. */
export const CODE_LANGUAGES: Readonly<Partial<Record<string, string>>> = {
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  go: 'go',
  h: 'c',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
};

/** Code mime types and the Shiki language each renders with. */
export const CODE_MIME_LANGUAGES: Readonly<Partial<Record<string, string>>> = {
  'application/json': 'json',
  'application/javascript': 'javascript',
  'application/x-javascript': 'javascript',
  'application/xml': 'xml',
  'text/css': 'css',
  'text/javascript': 'javascript',
  'text/x-python': 'python',
  'text/xml': 'xml',
};

const SPREADSHEET_EXTENSION_SET = new Set<string>(SPREADSHEET_EXTENSIONS);
const PRESENTATION_EXTENSION_SET = new Set<string>(PRESENTATION_EXTENSIONS);

const FILE_KIND_LABELS: Record<Exclude<FileKind, 'file'>, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  document: 'Document',
  presentation: 'Presentation',
  spreadsheet: 'Spreadsheet',
  code: 'Code',
  html: 'HTML',
  archive: 'Archive',
};

/** The mime type without parameters, lowercased: `Text/Plain; charset=utf-8` reads `text/plain`. */
export function baseMime(mimeType: string): string {
  return (mimeType.split(';').at(0) ?? '').trim().toLowerCase();
}

/** The lowercased extension; empty for no dot, a trailing dot, or a dotfile like `.env`. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

function kindFromExtension(extension: string): FileKind | null {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (SPREADSHEET_EXTENSION_SET.has(extension)) return 'spreadsheet';
  if (PRESENTATION_EXTENSION_SET.has(extension)) return 'presentation';
  if (CODE_LANGUAGES[extension] !== undefined) return 'code';
  if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  return null;
}

function kindFromMime(mime: string): FileKind | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (SPREADSHEET_MIME_HINTS.some((hint) => mime.includes(hint))) return 'spreadsheet';
  if (PRESENTATION_MIME_HINTS.some((hint) => mime.includes(hint))) return 'presentation';
  if (CODE_MIME_LANGUAGES[mime] !== undefined) return 'code';
  if (ARCHIVE_MIME_HINTS.some((hint) => mime.includes(hint))) return 'archive';
  if (DOCUMENT_MIME_HINTS.some((hint) => mime.includes(hint)) || mime === 'text/plain') {
    return 'document';
  }
  return null;
}

/**
 * The broad kind of a file. A specific mime type wins even over a misleading extension; for the
 * generic types agents and browsers emit (`text/plain` for a .md, `application/octet-stream` for a
 * .csv, an unknown mime for an upload) the extension supplies the missing detail.
 */
export function fileKind(mimeType: string, name = ''): FileKind {
  const mime = baseMime(mimeType);
  const mimeKind = kindFromMime(mime);
  if (mimeKind && mime !== 'text/plain') return mimeKind;
  return kindFromExtension(fileExtension(name)) ?? mimeKind ?? 'file';
}

/** The type word under a file name in chat: "PDF", "Spreadsheet"; an unknown kind names its extension ("RTF file"). */
export function fileKindLabel(mimeType: string, name = ''): string {
  const kind = fileKind(mimeType, name);
  if (kind !== 'file') return FILE_KIND_LABELS[kind];
  const extension = fileExtension(name);
  return extension ? `${extension.toUpperCase()} file` : 'File';
}

/**
 * The short uppercase badge on Library tiles and picker rows: 'PDF', 'CSV', 'PNG'. The extension
 * wins because it is what people recognise; then the mime subtype; 'FILE' when neither says anything.
 */
export function fileExtensionBadge(mimeType: string, name: string): string {
  const extension = fileExtension(name);
  if (extension !== '' && extension.length <= 5) return extension.toUpperCase();
  const subtype = baseMime(mimeType).split('/')[1] ?? '';
  if (subtype !== '' && subtype.length <= 5) return subtype.toUpperCase();
  return 'FILE';
}

export function isImageMime(mimeType: string): boolean {
  return baseMime(mimeType).startsWith('image/');
}

/** Video files use a file glyph and a play badge. */
export function isVideoMime(mimeType: string): boolean {
  return baseMime(mimeType).startsWith('video/');
}

// Extensions whose meaning is clear enough for the type glyph and caption to carry it. The list is
// allow-listed: an unfamiliar or ambiguous suffix stays visible so a stored name never looks lossy.
const HIDDEN_DISPLAY_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'c',
  'cc',
  'cpp',
  'cs',
  'css',
  'csv',
  'doc',
  'docx',
  'gif',
  'go',
  'h',
  'heic',
  'heif',
  'htm',
  'html',
  'java',
  'jpeg',
  'jpg',
  'js',
  'json',
  'jsx',
  'md',
  'markdown',
  'mjs',
  'mov',
  'mp3',
  'mp4',
  'numbers',
  'odp',
  'ods',
  'odt',
  'pages',
  'pdf',
  'php',
  'png',
  'ppt',
  'pptx',
  'py',
  'rb',
  'rs',
  'rtf',
  'svg',
  'sh',
  'sql',
  'swift',
  'tif',
  'tiff',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'toml',
  'wav',
  'webm',
  'webp',
  'xls',
  'xlsx',
  'xml',
  'yaml',
  'yml',
]);

/** Display-only filename treatment; the stored and rename value stays intact. */
export function displayFilename(filename: string): string {
  const extension = fileExtension(filename);
  return HIDDEN_DISPLAY_EXTENSIONS.has(extension)
    ? filename.slice(0, filename.length - extension.length - 1)
    : filename;
}
