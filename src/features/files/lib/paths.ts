// Display folders are rooted at /; immutable storage keys begin with ws/{workspaceId}/.
// Validate the workspace prefix before any client-supplied path reaches storage.
export const ROOT = '/';

// The reserved shared-folder subtree is workspace-visible; other files are creator-only.
// Client and server share these pure path predicates.
export const TEAM_FOLDER_PATH = '/Team';
export const CHAT_UPLOADS_FOLDER_PATH = '/Chat uploads';
// Every member's agent saves into these fixed paths, so whoever creates one first
// must not lock the others out. The tools and artifact saves import the same constants.
export const ARTIFACTS_FOLDER_PATH = '/Artifacts';
export const GENERATED_IMAGES_FOLDER_PATH = '/Generated images';
export const GENERATED_VIDEOS_FOLDER_PATH = '/Generated videos';
export const GENERATED_AUDIO_FOLDER_PATH = '/Generated audio';
export const TRANSCRIPTS_FOLDER_PATH = '/Transcripts';
export const AGENT_OUTPUT_FOLDER_PATHS = [
  ARTIFACTS_FOLDER_PATH,
  GENERATED_IMAGES_FOLDER_PATH,
  GENERATED_VIDEOS_FOLDER_PATH,
  GENERATED_AUDIO_FOLDER_PATH,
  TRANSCRIPTS_FOLDER_PATH,
] as const;

/** True when `path` is the Team folder itself or a descendant of it. */
export function isTeamPath(path: string): boolean {
  return path === TEAM_FOLDER_PATH || path.startsWith(`${TEAM_FOLDER_PATH}/`);
}

/**
 * True when `path` is the reserved root Team folder itself — the one create/
 * rename/delete/move must protect. Subfolders under it (`/Team/…`) are normal.
 */
export function isReservedTeamRoot(path: string): boolean {
  return path === TEAM_FOLDER_PATH;
}

// A single path segment — a folder name OR a filename. Blocks only what truly
// breaks path/URL/filesystem semantics: separators (/ \) and the reserved set
const SEGMENT = /^[^/\\<>:"|?*]+$/;

/** True for a syntactically valid, already-normalized folder path. */
export function isValidFolderPath(path: string): boolean {
  if (path === ROOT) return true;
  if (!path.startsWith('/') || path.endsWith('/') || path.includes('//')) return false;
  const segments = path.slice(1).split('/');
  return segments.every((s) => s !== '.' && s !== '..' && SEGMENT.test(s));
}

/**
 * Normalize arbitrary user input into a canonical folder path, or return null if
 * it can't be made valid. Collapses repeated slashes, strips a trailing slash,
 * and rejects '.'/'..' traversal segments.
 */
export function normalizeFolderPath(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '' || trimmed === ROOT) return ROOT;
  const segments = trimmed
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (segments.length === 0) return ROOT;
  if (segments.some((s) => s === '.' || s === '..' || !SEGMENT.test(s))) return null;
  return `/${segments.join('/')}`;
}

/** Validate a single new folder/file name segment (no slashes, no traversal). */
export function isValidSegment(name: string): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return false;
  return SEGMENT.test(trimmed);
}

/** Join a folder path with a child segment → child folder path. */
export function joinPath(folderPath: string, segment: string): string {
  const name = segment.trim();
  return folderPath === ROOT ? `/${name}` : `${folderPath}/${name}`;
}

/** Parent of a folder path. Parent of a top-level folder (and of root) is root. */
export function parentPath(path: string): string {
  if (path === ROOT) return ROOT;
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? ROOT : path.slice(0, idx);
}

/** Last segment (basename) of a folder path. Root → ''. */
export function basename(path: string): string {
  if (path === ROOT) return '';
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * True when `candidate` is the folder itself or a descendant of `folder`.
 * Used for subtree rename/delete and edit-share scoping. Root contains all.
 */
export function isWithin(folder: string, candidate: string): boolean {
  if (folder === ROOT) return true;
  return candidate === folder || candidate.startsWith(`${folder}/`);
}

/** Rewrite `candidate`'s prefix from `from` to `to` (subtree rename). */
export function rewritePrefix(candidate: string, from: string, to: string): string {
  if (candidate === from) return to;
  if (from === ROOT) return candidate; // root is never renamed
  return candidate.startsWith(`${from}/`) ? `${to}${candidate.slice(from.length)}` : candidate;
}

function workspacePrefix(workspaceId: string): string {
  return `ws/${workspaceId}`;
}

export function storagePathFor(workspaceId: string, folderPath: string, filename: string): string {
  const dir = folderPath === ROOT ? '' : folderPath;
  return `${workspacePrefix(workspaceId)}${dir}/${filename}`;
}

export function splitStoragePath(
  workspaceId: string,
  storagePath: string,
): { folderPath: string; filename: string } | null {
  if (!isValidFolderPath(`/${storagePath}`)) return null;
  const prefix = workspacePrefix(workspaceId);
  if (storagePath !== prefix && !storagePath.startsWith(`${prefix}/`)) return null;
  const rest = storagePath.slice(prefix.length); // '' or '/a/b/file.ext'
  const lastSlash = rest.lastIndexOf('/');
  if (lastSlash < 0) return null;
  const filename = rest.slice(lastSlash + 1);
  if (filename === '' || !isValidSegment(filename)) return null;
  const dir = rest.slice(0, lastSlash); // '' (root) or '/a/b'
  const folderPath = dir === '' ? ROOT : dir;
  return isValidFolderPath(folderPath) ? { folderPath, filename } : null;
}

/** Breadcrumb segments for a folder path: [{name,path}], root first. */
export function breadcrumb(path: string): Array<{ name: string; path: string }> {
  const crumbs = [{ name: 'Files', path: ROOT }];
  if (path === ROOT) return crumbs;
  let acc = '';
  for (const segment of path.slice(1).split('/')) {
    acc += `/${segment}`;
    crumbs.push({ name: segment, path: acc });
  }
  return crumbs;
}
