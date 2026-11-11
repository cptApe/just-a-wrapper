import 'server-only';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { db } from '@/db';
import { file, folder } from '@/db/schema';
import { fileContentUrl } from '@/lib/file-content-url';
import {
  PRESENTATION_EXTENSIONS,
  PRESENTATION_MIME_HINTS,
  SPREADSHEET_EXTENSIONS,
  SPREADSHEET_MIME_HINTS,
  type TypeFacet,
} from '../lib/file-types';
import { type LibraryFilesQuery } from '../lib/library-items';
import { escapeLike, insidePath } from '../lib/path-sql';
import { basename, ROOT, TEAM_FOLDER_PATH } from '../lib/paths';
import { fileVisibleTo, folderVisibleTo } from '../lib/team-folder';
import { trashCutoff } from '../lib/trash-machine';
import type { FileEntry, FolderEntry } from '../types';

// File reads use the same paginated SQL projection for initial and load-more requests.
// Folders load together because breadcrumbs, move targets and counts need the tree.

const FILES_PAGE_SIZE = 60;

export type { LibraryFilesQuery } from '../lib/library-items';

export type LibraryFilesPage = {
  files: FileEntry[];
  hasMore: boolean;
  /** Trash queries return the deleted subtree-root folders on the first page
      (they restore as units; their contents stay off the flat file list). */
  deletedFolders?: FolderEntry[];
};

function facetCondition(facet: TypeFacet): SQL {
  const extLike = (extensions: readonly string[]) =>
    extensions.map((extension) => ilike(file.filename, `%.${extension}`));
  const mimeLike = (hints: readonly string[]) =>
    hints.map((hint) => ilike(file.mimeType, `%${hint}%`));
  switch (facet) {
    case 'images':
      return ilike(file.mimeType, 'image/%');
    case 'pdfs':
      return sql`(${file.mimeType} = 'application/pdf' or ${file.filename} ilike '%.pdf')`;
    case 'spreadsheets':
      return sql`(${or(...mimeLike(SPREADSHEET_MIME_HINTS), ...extLike(SPREADSHEET_EXTENSIONS))})`;
    case 'presentations':
      return sql`(${or(...mimeLike(PRESENTATION_MIME_HINTS), ...extLike(PRESENTATION_EXTENSIONS))})`;
    case 'documents':
      return sql`not (${facetCondition('images')} or ${facetCondition('pdfs')} or ${facetCondition('spreadsheets')} or ${facetCondition('presentations')})`;
  }
}

export function toFileEntry(r: {
  id: string;
  filename: string;
  folderPath: string;
  mimeType: string;
  sizeBytes: number;
  source: FileEntry['source'];
  createdAt: Date;
  deletedAt: Date | null;
}): FileEntry {
  return {
    id: r.id,
    filename: r.filename,
    folderPath: r.folderPath,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    url: fileContentUrl(r.id, null),
    source: r.source,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}

const fileColumns = {
  id: file.id,
  filename: file.filename,
  folderPath: file.folderPath,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  source: file.source,
  createdAt: file.createdAt,
  deletedAt: file.deletedAt,
};

// SQL twin of `fileExtensionBadge`: the extension when it is 1–5 characters, else
// the mime subtype, lower-cased so 'PDF' and 'pdf' sort together.
const fileTypeKeyExpr = sql<string>`case
  when ${file.filename} ~ '\\.[A-Za-z0-9]{1,5}$'
    then lower(substring(${file.filename} from '\\.([A-Za-z0-9]{1,5})$'))
  else lower(split_part(split_part(${file.mimeType}, ';', 1), '/', 2))
end`;

/** One page of files under a Library query (offset-paginated, stable order).
    `viewerId` scopes visibility: a viewer sees only files they created plus the
    shared Team subtree (fileVisibleTo) — applied unconditionally so search and
    facet (which drop folder scope) can never leak a teammate's private files. */
export async function loadFilesPage(
  workspaceId: string,
  viewerId: string,
  query: LibraryFilesQuery,
): Promise<LibraryFilesPage> {
  const q = query.q.trim();
  const conditions: SQL[] = [eq(file.workspaceId, workspaceId), fileVisibleTo(viewerId)];

  let deletedFolders: (FolderEntry & { deletedAt: string })[] | undefined;
  if (query.trash) {
    conditions.push(isNotNull(file.deletedAt), gt(file.deletedAt, trashCutoff(new Date())));
    // Files inside a deleted folder subtree restore WITH the folder — keep
    // them off the flat listing so the trash reads as what was deleted.
    deletedFolders = await loadDeletedFolders(workspaceId, viewerId);
    for (const f of deletedFolders) {
      conditions.push(
        sql`not (${file.deletedAt} = ${new Date(f.deletedAt)} and ${insidePath(file.folderPath, f.path)})`,
      );
    }
  } else {
    conditions.push(isNull(file.deletedAt));
    // Folder scope only applies while browsing — searching or faceting widens
    // to the whole drive (matches shouldn't hide behind the current folder).
    if (q === '' && query.type === null) {
      conditions.push(eq(file.folderPath, query.path));
    }
  }
  if (!query.trash && query.type !== null) conditions.push(facetCondition(query.type));
  if (q !== '') conditions.push(ilike(file.filename, `%${escapeLike(q)}%`));

  const direction = query.dir === 'asc' ? asc : desc;
  const orderBy =
    query.sort === 'kind'
      ? // Same type reads alphabetically, matching the client's Type column.
        [direction(fileTypeKeyExpr), asc(file.filename), asc(file.id)]
      : [
          direction(
            query.sort === 'name'
              ? file.filename
              : query.sort === 'size'
                ? file.sizeBytes
                : file.createdAt,
          ),
          asc(file.id),
        ];

  const rows = await db
    .select(fileColumns)
    .from(file)
    .where(and(...conditions))
    .orderBy(...orderBy)
    .offset(query.offset)
    .limit(FILES_PAGE_SIZE + 1);

  return {
    files: rows.slice(0, FILES_PAGE_SIZE).map(toFileEntry),
    hasMore: rows.length > FILES_PAGE_SIZE,
    ...(query.trash && query.offset === 0 ? { deletedFolders } : {}),
  };
}

export async function loadFolders(workspaceId: string, viewerId: string): Promise<FolderEntry[]> {
  const rows = await db
    .select({ id: folder.id, path: folder.path, createdAt: folder.createdAt })
    .from(folder)
    .where(
      and(eq(folder.workspaceId, workspaceId), isNull(folder.deletedAt), folderVisibleTo(viewerId)),
    );
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    name: basename(r.path),
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Folder paths the viewer created and may therefore create edit-mode shares
 * for without an owner/admin role. The server action independently enforces the
 * same rule; this projection only drives the disabled UI state. */
export async function loadEditableFolderPaths(
  workspaceId: string,
  viewerId: string,
): Promise<string[]> {
  const rows = await db
    .select({ path: folder.path })
    .from(folder)
    .where(
      and(
        eq(folder.workspaceId, workspaceId),
        eq(folder.createdByUserId, viewerId),
        ne(folder.path, TEAM_FOLDER_PATH),
        isNull(folder.deletedAt),
      ),
    );
  return rows.map((row) => row.path);
}

/**
 * Soft-deleted folders still inside the trash window, reduced to subtree roots
 * (a folder whose parent is also deleted rides along with — and restores with —
 * its parent).
 */
async function loadDeletedFolders(
  workspaceId: string,
  viewerId: string,
): Promise<(FolderEntry & { deletedAt: string })[]> {
  const rows = await db
    .select({
      id: folder.id,
      path: folder.path,
      createdAt: folder.createdAt,
      deletedAt: folder.deletedAt,
    })
    .from(folder)
    .where(
      and(
        eq(folder.workspaceId, workspaceId),
        gt(folder.deletedAt, trashCutoff(new Date())),
        folderVisibleTo(viewerId),
      ),
    );
  const deletedRows = rows.flatMap((row) =>
    row.deletedAt === null ? [] : [{ ...row, deletedAt: row.deletedAt }],
  );
  const groups = new Set(deletedRows.map((row) => `${row.path}:${row.deletedAt.getTime()}`));
  return deletedRows
    .filter((r) => {
      const parent = r.path.slice(0, r.path.lastIndexOf('/')) || ROOT;
      return !groups.has(`${parent}:${r.deletedAt.getTime()}`);
    })
    .map((r) => ({
      id: r.id,
      path: r.path,
      name: basename(r.path),
      createdAt: r.createdAt.toISOString(),
      deletedAt: r.deletedAt.toISOString(),
    }));
}

/** Direct live-file counts per folder path (folder tile meta). */
export async function loadFolderCounts(
  workspaceId: string,
  viewerId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ folderPath: file.folderPath, count: sql<number>`count(*)::int` })
    .from(file)
    .where(and(eq(file.workspaceId, workspaceId), isNull(file.deletedAt), fileVisibleTo(viewerId)))
    .groupBy(file.folderPath);
  return Object.fromEntries(rows.map((r) => [r.folderPath, r.count]));
}

/** Every live file visible to `viewerId` in a workspace — the preview overlay's
    whole-drive set (`/api/library/items`) reads this; the Library page itself
    paginates. (The public share page goes through resolveShare, not here.) */
export async function loadFiles(workspaceId: string, viewerId: string): Promise<FileEntry[]> {
  const rows = await db
    .select(fileColumns)
    .from(file)
    .where(and(eq(file.workspaceId, workspaceId), isNull(file.deletedAt), fileVisibleTo(viewerId)));
  return rows.map(toFileEntry);
}

// Member browsing always applies visibility, even at the workspace root.
export async function loadFilesInFolder(
  workspaceId: string,
  folderPath: string,
  viewerId: string,
): Promise<FileEntry[]> {
  const rows = await db
    .select(fileColumns)
    .from(file)
    .where(
      and(
        eq(file.workspaceId, workspaceId),
        eq(file.folderPath, folderPath),
        isNull(file.deletedAt),
        fileVisibleTo(viewerId),
      ),
    );
  return rows.map(toFileEntry);
}

/** The files a public link lists; `scope` is `shareFileScope` from live-share.ts. */
export async function loadFilesInScope(scope: SQL): Promise<FileEntry[]> {
  const rows = await db.select(fileColumns).from(file).where(scope);
  return rows.map(toFileEntry);
}
