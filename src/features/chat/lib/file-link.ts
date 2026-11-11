import { FILE_CONTENT_PATH } from '@/lib/file-content-url';
// Centralize preview and download resolution for Library files and task artifacts.
// Every chat file surface uses the same decisions.
// Keep this pure with relative .ts imports for Node tests.

import { classifyArtifact } from '@/features/files/lib/artifact-kind';
import { artifactContentUrl } from '@/features/files/lib/content-url';
import { downloadUrl } from '@/features/files/lib/download-url';
import type { ArtifactSummary, FileEntry } from '@/features/files/types';
import { buildOverlayHash } from '@/features/overlays/lib/hash';
import type { OverlayHash } from '@/features/overlays/lib/tokens';

export type ChatFileTarget =
  | { kind: 'library'; file: FileEntry }
  | { kind: 'artifact'; artifact: ArtifactSummary; sessionId: string | null };

export type OpenFileAction = { kind: 'open'; hash: OverlayHash };
export type DownloadFileAction = {
  kind: 'download';
  href: string;
  filename: string;
};
export type ChatFileAction = OpenFileAction | DownloadFileAction;

/** Everything a reply's links can resolve against. */
export type FileLinkIndex = {
  libraryFiles: readonly FileEntry[];
  artifacts: readonly ArtifactSummary[];
  /** The task route's session id; null outside a task (no artifact panel). */
  sessionId: string | null;
};

const ARTIFACT_CONTENT_PATH = /^\/api\/artifacts\/([^/?#]+)\/content(?:[?#].*)?$/;
const TASK_ROUTE = /^\/app\/task\/([^/]+)/;

/** The session id a task route carries, or null anywhere else. */
export function chatSessionIdFromPath(pathname: string): string | null {
  const match = TASK_ROUTE.exec(pathname);
  // Session ids are URL-safe, and an undecoded segment cannot throw during render.
  return match?.[1] ?? null;
}

/**
 * Whether the side panel can show this file when a chat link or card opens it.
 * Everything the artifact viewer renders counts, except audio: sound (and
 * anything the viewer would only offer for download) goes straight to a
 * download from chat instead of opening an empty-looking panel.
 */
function isChatPreviewable(mimeType: string, filename: string): boolean {
  const kind = classifyArtifact(mimeType, filename);
  return kind !== 'unknown' && kind !== 'audio';
}

export function targetName(target: ChatFileTarget): string {
  return target.kind === 'library' ? target.file.filename : target.artifact.filename;
}

export function targetMimeType(target: ChatFileTarget): string {
  return target.kind === 'library' ? target.file.mimeType : target.artifact.mimeType;
}

export function targetPreviewable(target: ChatFileTarget): boolean {
  return isChatPreviewable(targetMimeType(target), targetName(target));
}

/** The panel this file opens in, or null when no panel can show it here (an
 * artifact outside its task route has no task panel to land in). */
export function openAction(target: ChatFileTarget): OpenFileAction | null {
  if (target.kind === 'library') {
    return { kind: 'open', hash: buildOverlayHash('file', target.file.id) };
  }
  if (!target.sessionId) return null;
  return {
    kind: 'open',
    hash: buildOverlayHash('task-file', target.artifact.id, {
      session: target.sessionId,
    }),
  };
}

/** Where a download goes, or null when the bytes cannot be served. */
export function downloadAction(target: ChatFileTarget): DownloadFileAction | null {
  if (target.kind === 'library') {
    return {
      kind: 'download',
      href: downloadUrl(target.file.url),
      filename: target.file.filename,
    };
  }
  if (!target.artifact.downloadable) return null;
  return {
    kind: 'download',
    href: artifactContentUrl(target.artifact.id, { download: true }),
    filename: target.artifact.filename,
  };
}

/**
 * What a click on the file itself does: open the panel when the panel can show
 * it, otherwise download. Null means the file is inert here (nothing to open,
 * nothing to download), and the surface must render no action at all.
 */
export function primaryAction(target: ChatFileTarget): ChatFileAction | null {
  const open = openAction(target);
  if (targetPreviewable(target) && open) return open;
  return downloadAction(target) ?? open;
}

function stripQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

function lastSegment(path: string): string {
  const clean = stripQuery(path);
  return clean.slice(clean.lastIndexOf('/') + 1);
}

/** A raw href segment names a file when it equals the name as written or as
 * a URL would encode it; decoding the segment could throw on a stray `%`. */
function segmentNames(segment: string, filename: string): boolean {
  const wanted = segment.toLowerCase();
  return wanted === filename.toLowerCase() || wanted === encodeURIComponent(filename).toLowerCase();
}

function hasExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1;
}

function isHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/** Cheap pre-check: could this href name a file at all? Fragments and links
 * whose last segment carries no extension never trigger an index load. */
export function looksLikeFileHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('mailto:')) return false;
  if (ARTIFACT_CONTENT_PATH.test(trimmed) || FILE_CONTENT_PATH.test(trimmed)) return true;
  return hasExtension(lastSegment(trimmed));
}

/**
 * Resolve a link an assistant wrote to a known file. Three shapes match, in
 * order: the artifact content path (`/api/artifacts/<id>/content`), a
 * Library file's exact durable URL, and, for non-web hrefs only (a sandbox
 * path, a bare file name), a file NAME that matches one artifact of this task
 * or exactly one Library file. Web URLs never match by name, so an external
 * `https://example.com/index.html` can never be hijacked by a Library file
 * that happens to share the name.
 */
export function resolveFileLink(href: string, index: FileLinkIndex): ChatFileTarget | null {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  const artifactPath = ARTIFACT_CONTENT_PATH.exec(trimmed);
  if (artifactPath) {
    const artifact = index.artifacts.find((candidate) => candidate.id === artifactPath[1]);
    return artifact ? { kind: 'artifact', artifact, sessionId: index.sessionId } : null;
  }

  const filePath = FILE_CONTENT_PATH.exec(trimmed);
  if (filePath) {
    const file = index.libraryFiles.find((entry) => entry.id === filePath[1]);
    return file ? { kind: 'library', file } : null;
  }

  if (isHttpUrl(trimmed)) {
    const wanted = stripQuery(trimmed);
    const file = index.libraryFiles.find(
      (candidate) => candidate.url === trimmed || stripQuery(candidate.url) === wanted,
    );
    return file ? { kind: 'library', file } : null;
  }

  const segment = lastSegment(trimmed);
  if (!hasExtension(segment)) return null;
  // Newest artifact wins when a task produced the same name twice.
  const artifact = [...index.artifacts]
    .reverse()
    .find((candidate) => segmentNames(segment, candidate.filename));
  if (artifact) return { kind: 'artifact', artifact, sessionId: index.sessionId };
  const libraryMatches = index.libraryFiles.filter((candidate) =>
    segmentNames(segment, candidate.filename),
  );
  const onlyMatch = libraryMatches.at(0);
  return libraryMatches.length === 1 && onlyMatch ? { kind: 'library', file: onlyMatch } : null;
}
