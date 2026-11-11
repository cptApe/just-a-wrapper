// Pure note helpers model documents at hierarchical memory paths.
// Folders derive from nested note paths; keep this free of SDK, React and I/O.

export const NOTE_ROOT = '/';

// A single path segment — mirrors the files-surface segment rule, plus the
// memories API's own constraints (no '.'/'..', no control characters).
const SEGMENT = /^[^/\\<>:"|?*\u0000-\u001f]+$/;

/** True for a syntactically valid, already-normalized note path (`/a/b.md`). */
export function isValidNotePath(path: string): boolean {
  if (!path.startsWith('/') || path.endsWith('/') || path.includes('//')) return false;
  const segments = path.slice(1).split('/');
  return (
    segments.length > 0 &&
    segments.every((s) => s !== '.' && s !== '..' && s !== '' && SEGMENT.test(s))
  );
}

function isValidNoteSegment(name: string): boolean {
  const trimmed = name.trim();
  return trimmed !== '' && trimmed !== '.' && trimmed !== '..' && SEGMENT.test(trimmed);
}

/** Normalize arbitrary input into a canonical folder path, or null. */
export function normalizeNoteFolder(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '' || trimmed === NOTE_ROOT) return NOTE_ROOT;
  const segments = trimmed
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (segments.length === 0) return NOTE_ROOT;
  if (segments.some((s) => !isValidNoteSegment(s))) return null;
  return `/${segments.join('/')}`;
}

export function joinNotePath(folderPath: string, segment: string): string {
  const name = segment.trim();
  return folderPath === NOTE_ROOT ? `/${name}` : `${folderPath}/${name}`;
}

export function noteParentPath(path: string): string {
  if (path === NOTE_ROOT) return NOTE_ROOT;
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? NOTE_ROOT : path.slice(0, idx);
}

/** Last segment (filename) of a note path. */
export function noteBasename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The note's display title: filename without a trailing `.md`/`.txt`. */
export function noteTitle(path: string): string {
  return noteBasename(path).replace(/\.(md|txt)$/i, '');
}

const NOTE_TITLE_MAX_LENGTH = 48;

/** A user-facing title derived from the first content line, never mid-word. */
function deriveNoteTitle(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const title = deriveTitleFromLine(line);
    if (title !== null) return title;
  }
  return 'Untitled';
}

function deriveTitleFromLine(line: string): string | null {
  let withoutLeadingSyntax = line.trim();
  let previous = '';
  while (withoutLeadingSyntax !== previous) {
    previous = withoutLeadingSyntax;
    withoutLeadingSyntax = withoutLeadingSyntax
      .replace(/^(?:#{1,6}|>|[-+*]|\d+[.)])(?:\s+|$)/, '')
      .replace(/^\[[ xX]\]\s+/, '');
  }
  const plain = withoutLeadingSyntax
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(^|[\s([{])\*\*(.+?)\*\*(?=$|[\s)\]},.!?:;])/g, '$1$2')
    .replace(/(^|[\s([{])__(.+?)__(?=$|[\s)\]},.!?:;])/g, '$1$2')
    .replace(/(^|[\s([{])~~(.+?)~~(?=$|[\s)\]},.!?:;])/g, '$1$2')
    .replace(/(^|[\s([{])`(.+?)`(?=$|[\s)\]},.!?:;])/g, '$1$2')
    .replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)~(.+?)~(?=\s|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain === '' || !/[\p{L}\p{N}]/u.test(plain)) return null;
  if (plain.length <= NOTE_TITLE_MAX_LENGTH) return plain;

  const boundary = plain.lastIndexOf(' ', NOTE_TITLE_MAX_LENGTH);
  if (boundary > 0) return plain.slice(0, boundary);
  return plain.slice(0, NOTE_TITLE_MAX_LENGTH);
}

/** The derived title as a valid, extension-bearing memory-store path segment. */
export function derivedNoteFilename(content: string, extension: string): string {
  const safeTitle = deriveNoteTitle(content)
    .replace(/[/\\<>:"|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title =
    safeTitle === '' || safeTitle === '.' || safeTitle === '..' ? 'Untitled' : safeTitle;
  return `${title}${extension}`;
}

/** Pick an available sibling path, adding a familiar numeric suffix if needed. */
export function uniqueNotePath(
  folderPath: string,
  filename: string,
  existingPaths: Iterable<string>,
  ignorePath: string | null,
): string {
  const occupied = new Set([...existingPaths].filter((path) => path !== ignorePath));
  const first = joinNotePath(folderPath, filename);
  if (!occupied.has(first)) return first;

  const lastDot = filename.lastIndexOf('.');
  const extensionIndex = lastDot > 0 ? lastDot : filename.length;
  const stem = filename.slice(0, extensionIndex);
  const extension = filename.slice(extensionIndex);
  for (let suffix = 2; ; suffix += 1) {
    const candidate = joinNotePath(folderPath, `${stem} (${suffix})${extension}`);
    if (!occupied.has(candidate)) return candidate;
  }
}

/** One document in a memory store, as the Library surfaces it. */
export type MemoryNote = {
  /** `mem_...` — stable across renames. */
  id: string;
  /** SHA-256 returned by the store; the editor uses it as its save precondition. */
  contentSha256: string;
  /** `/`-prefixed path, unique per store. */
  path: string;
  sizeBytes: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /** Populated on full reads (Read view, the note overlay); null on basic lists. */
  content: string | null;
};

/** One immutable row in a note's history (Foundations/Memory: recovery). */
export type MemoryNoteVersion = {
  /** `memver_...` */
  id: string;
  operation: 'created' | 'modified' | 'deleted';
  createdAt: string; // ISO
  /** Who wrote it: the agent (session), the app (api key), or a console user. */
  actor: 'agent' | 'app' | 'user';
  sizeBytes: number | null;
  /** Path at the time of the write. */
  path: string | null;
};

/** A deleted note still inside the 30-day trash window. */
export type DeletedMemoryNote = {
  /** The dead note's `mem_...` id (versions outlive the note). */
  memoryId: string;
  /** The tombstone version's `memver_...` id. */
  tombstoneVersionId: string;
  path: string;
  deletedAt: string; // ISO
  actor: MemoryNoteVersion['actor'];
};
