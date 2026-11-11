import { parseFileContentUrl } from '@/lib/file-content-url';
import { LIBRARY_READ_INSTRUCTION, SANDBOX_PATH_PREFIX } from './build-composer-message';

// Display-layer scrubbing of `<attached_files>` blocks from user messages.
//
// The composer surfaces uploaded and Library files to the agent by appending an
// `<attached_files> … </attached_files>` block onto the user's own message (see
// lib/build-composer-message.ts). The agent MUST keep receiving that
// block — it carries the durable URLs and the folder paths it acts on — so this
// is strictly a render-time transform: we strip the block from what the human
// sees and hand back typed entries to render as chips, never touching the wire.

const ATTACHED_FILES_BLOCK = /<attached_files>[\s\S]*?<\/attached_files>/gi;

// Folders ride as `{name}/ (folder) — Library folder {path}` (produced by
// lib/build-composer-message.ts); files ride as `{name} — {url}`. We recognize the folder
// shape structurally so the human sees a folder chip, never the raw path.
const FOLDER_NAME_SUFFIX = '/ (folder)';
const LIBRARY_FOLDER_PREFIX = 'Library folder ';
const ENTRY_SEPARATOR = ' — ';

/** One attachment parsed out of an `<attached_files>` block, for chip rendering. */
export type AttachedEntry =
  | { kind: 'file'; name: string; url: string | null }
  | { kind: 'folder'; name: string; path: string };

type StrippedMessage = {
  /** The user-visible text with any attached-files blocks removed. */
  text: string;
  /** The attachments parsed out of those blocks, in document order. */
  entries: AttachedEntry[];
  /** Whether at least one attached-files block was present (even if empty). */
  hadAttachments: boolean;
};

/**
 * Strip the `<attached_files>` blocks from a message and return both the
 * human-visible text and the parsed attachment entries. Single pass: the block
 * is removed and its lines parsed in one `replace` callback, so a global-regex
 * `lastIndex` can't drift between two calls.
 */
export function stripAttachedFiles(raw: string): StrippedMessage {
  const entries: AttachedEntry[] = [];
  let hadAttachments = false;
  const text = raw
    .replace(ATTACHED_FILES_BLOCK, (block) => {
      hadAttachments = true;
      const body = block.replace(/^<attached_files>/i, '').replace(/<\/attached_files>$/i, '');
      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // This line is for the agent only. The preceding durable-URL line owns
        // the human chip, so rendering the mount hint would duplicate it.
        if (trimmed.startsWith(SANDBOX_PATH_PREFIX) || trimmed === LIBRARY_READ_INSTRUCTION)
          continue;
        entries.push(parseEntryLine(trimmed));
      }
      return '';
    })
    .trim();
  return { text, entries, hadAttachments };
}

/**
 * Parse one attachment line into a typed entry. A `Name/ (folder) — Library
 * folder /path` line becomes a folder; a `Name — https://url` line a file. Any
 * line that matches neither shape is kept as a name-only file so nothing
 * silently disappears from the human's view.
 */
function parseEntryLine(line: string): AttachedEntry {
  // Folder lines are matched on the FIRST occurrence of the full folder marker
  // (`/ (folder) — Library folder `), not a generic separator split: a folder
  // whose own name or path contains ` — ` must still parse as a folder, never
  // fall through to a file chip leaking the raw reference.
  const folderMarker = `${FOLDER_NAME_SUFFIX}${ENTRY_SEPARATOR}${LIBRARY_FOLDER_PREFIX}`;
  const markerIndex = line.indexOf(folderMarker);
  if (markerIndex !== -1) {
    return {
      kind: 'folder',
      name: line.slice(0, markerIndex).trim(),
      path: line.slice(markerIndex + folderMarker.length).trim(),
    };
  }
  const parts = line.split(ENTRY_SEPARATOR);
  if (parts.length >= 2) {
    const rhs = parts.at(-1)?.trim() ?? '';
    const lhs = parts.slice(0, -1).join(ENTRY_SEPARATOR).trim();
    return {
      kind: 'file',
      name: lhs,
      url: /^https?:\/\//.test(rhs) || parseFileContentUrl(rhs) !== null ? rhs : null,
    };
  }
  return { kind: 'file', name: line, url: null };
}
