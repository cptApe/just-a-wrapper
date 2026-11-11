// Pure paging over a memory store's note list. No value imports, so Node's test runner loads it.

/** A store page the matcher reads: the note paths on it and the cursor to the next one. */
export type NotePathPage<Note extends { path: string }> = {
  notes: Note[];
  nextCursor: string | null;
};

/** Upper bound on pages read per store, so one query cannot walk an unbounded store. */
export const MAX_NOTE_PAGES = 20;

/**
 * Walk a store page by page and keep the notes whose path holds the query, in store order.
 * Stops at `limit` matches, at the last page, or after `MAX_NOTE_PAGES` pages.
 */
export async function matchNotesByPath<Note extends { path: string }>(input: {
  query: string;
  limit: number;
  listPage: (cursor: string | null) => Promise<NotePathPage<Note>>;
}): Promise<Note[]> {
  const q = input.query.toLowerCase();
  const matches: Note[] = [];
  let cursor: string | null = null;
  for (let read = 0; read < MAX_NOTE_PAGES; read += 1) {
    const page = await input.listPage(cursor);
    for (const note of page.notes) {
      if (!note.path.toLowerCase().includes(q)) continue;
      matches.push(note);
      if (matches.length >= input.limit) return matches;
    }
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return matches;
}

/** "Your memory" for a note at the root, "Your memory /projects" for one in a folder. */
export function noteLocation(label: string, path: string): string {
  const folder = path.slice(0, path.lastIndexOf('/'));
  return folder === '' ? label : `${label} ${folder}`;
}
