// Relative + explicit .ts (not '@/…') so node:test can load this pure module —
// paths.ts is itself pure/no-I-O by design, exactly for this.
import { joinPath, normalizeFolderPath } from '@/features/files/lib/paths';

// Pure core of the list_library_folder executor, split out of the server-only
// handler so the path-validation guard and the entry mapping are unit-testable
// under node:test. (paths.ts is pure/no-I-O by design, so importing it here is
// test-safe.) The DB workspace-scoping lives in the handler: it always calls the
// listing read with ctx.workspaceId, and the path never feeds that filter — so a
// session structurally cannot list another workspace, whatever path it passes.

export type LibraryListingEntry = {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  size?: number;
  url?: string;
};

export type RawLibraryListing = {
  files: Array<{ filename: string; sizeBytes: number; url: string }>;
  folders: Array<{ name: string; path: string }>;
};

/**
 * Validate + normalize the requested folder path. A traversal or otherwise
 * un-normalizable path returns a `message` (the caller returns an empty listing
 * with it) — never an error. A valid path returns its normalized form.
 */
export function resolveLibraryPath(rawPath: string): { path: string; message?: string } {
  const normalized = normalizeFolderPath(rawPath);
  if (normalized === null) {
    return {
      path: rawPath,
      message: `"${rawPath}" is not a valid folder path. Use "/" for the Library root.`,
    };
  }
  return { path: normalized };
}

/** Map a (workspace-scoped) one-level listing into the tool's entries: folders
    first (recurse by path), then files (fetch by url). */
export function toLibraryEntries(
  normalizedPath: string,
  listing: RawLibraryListing,
): LibraryListingEntry[] {
  return [
    ...listing.folders.map((f) => ({ name: f.name, path: f.path, kind: 'folder' as const })),
    ...listing.files.map((f) => ({
      name: f.filename,
      path: joinPath(normalizedPath, f.filename),
      kind: 'file' as const,
      size: f.sizeBytes,
      url: f.url,
    })),
  ];
}
