'use client';
import Link from 'next/link';
import { z } from 'zod';
import { IconFile02 } from '@/components/icons';
import { formatBytes } from '@/lib/format/format-bytes';
import { isSafeInternalHref } from '@/lib/safe-internal-href';
import { lenientOptional } from '../../lib/lenient-optional';
import { libraryHref, libraryParentPath } from '../../lib/library-href';
import { parseResultObject } from '../../lib/tool-result-data';
import { DefaultDetails } from './default-outcome';
import { ReadingPane } from './reading-pane';
import type { ToolRendererProps } from './tool-renderer-types';

// Unfolded details for the Library verbs, phrased from what the handlers
// actually post (src/features/tools/custom-tools/library-verbs.ts): a search's
// matching files, a read's delivery, and the path a save / move / folder /
// delete landed on. Every path is a link into the Library. Off-contract
// results fall back to the default detail so nothing renders silent.

/** The folder half of a Library path — a file's parent, a folder itself. */
function folderOf(path: string, kind: 'file' | 'folder' | undefined): string {
  if (kind === 'folder') return path;
  return libraryParentPath(path);
}

function LibraryPathLink({ path, kind }: { path: string; kind?: 'file' | 'folder' }) {
  if (!isSafeInternalHref(path)) {
    return <span className="truncate text-meta text-foreground">{path}</span>;
  }
  return (
    <Link
      href={libraryHref(folderOf(path, kind))}
      className="truncate text-meta text-foreground underline underline-offset-4 hover:text-muted-foreground"
      data-testid="library-path-link"
    >
      {path}
    </Link>
  );
}

const searchSchema = z.object({
  results: z.array(
    z.object({
      path: z.string(),
      name: z.string(),
      size: z.number(),
      mimeType: z.string().catch(''),
    }),
  ),
  message: lenientOptional(z.string()),
  truncated: z.unknown().transform((value) => value === true),
});
const fileSchema = z.object({
  path: z.string(),
  delivery: lenientOptional(z.string()),
  text: lenientOptional(z.string()),
  message: lenientOptional(z.string()),
  truncated: z.unknown().transform((value) => value === true),
});
const receiptSchema = z.object({
  path: z.string(),
  kind: lenientOptional(z.enum(['file', 'folder'])),
  message: lenientOptional(z.string()),
});

/** `search_library`: the matching files as a readable list. */
export function LibrarySearchResults({ item }: ToolRendererProps) {
  if (!item.result) return null;
  const data = item.result.isError ? null : parseResultObject(item.result.text);
  const parsed = searchSchema.safeParse(data);
  if (!parsed.success) return <DefaultDetails item={item} />;
  const rows = parsed.data.results;
  if (rows.length === 0) {
    const message = parsed.data.message ?? 'No files matched';
    return <p className="text-meta text-muted-foreground">{message.replace(/\.$/, '')}</p>;
  }
  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" data-testid="library-search">
      {rows.map((row) => (
        <li key={row.path} className="flex min-w-0 items-center gap-2">
          <IconFile02 className="size-4 shrink-0 text-muted-foreground" />
          {isSafeInternalHref(row.path) ? (
            <Link
              href={libraryHref(folderOf(row.path, 'file'))}
              className="min-w-0 flex-1 truncate text-meta text-foreground underline-offset-4 hover:underline"
            >
              {row.name}
            </Link>
          ) : (
            <span className="min-w-0 flex-1 truncate text-meta text-foreground">{row.name}</span>
          )}
          <span className="shrink-0 text-meta font-medium text-muted-foreground">
            {formatBytes(row.size)}
          </span>
        </li>
      ))}
      {parsed.data.truncated ? (
        <li className="text-meta font-medium text-muted-foreground">Showing the first matches</li>
      ) : null}
    </ul>
  );
}

/** `read_library_file`: what the read delivered, never the whole file. */
export function LibraryFileDetails({ item }: ToolRendererProps) {
  if (!item.result) return null;
  const data = item.result.isError ? null : parseResultObject(item.result.text);
  const parsed = fileSchema.safeParse(data);
  if (!parsed.success) return <DefaultDetails item={item} />;
  const file = parsed.data;
  const delivery = file.delivery;
  if (delivery === 'missing') {
    const message = file.message ?? 'The file could not be read';
    return <p className="text-meta text-muted-foreground">{message.replace(/\.$/, '')}</p>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="library-file">
      <LibraryPathLink path={file.path} kind="file" />
      {delivery === 'inline' && file.text !== undefined ? (
        <ReadingPane text={file.text} className="max-h-48">
          {file.truncated ? (
            <span className="mt-1 block italic">The file is long, so only the start was read.</span>
          ) : null}
        </ReadingPane>
      ) : (
        <p className="text-meta text-muted-foreground">
          Opened the file for the agent to work with
        </p>
      )}
    </div>
  );
}

/** `save_to_library`, `move_library_item`, `create_library_folder`,
 *  `delete_library_item`: the path the change landed on, as a Library link,
 *  plus the handler's sentence when it had one to add. */
export function LibraryReceiptDetails({ item }: ToolRendererProps) {
  if (!item.result) return null;
  const data = item.result.isError ? null : parseResultObject(item.result.text);
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success) return <DefaultDetails item={item} />;
  const { kind, message, path } = parsed.data;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="library-receipt">
      <LibraryPathLink path={path} kind={kind} />
      {message ? <p className="text-meta text-muted-foreground">{message}</p> : null}
    </div>
  );
}
