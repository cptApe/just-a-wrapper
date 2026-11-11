// Store names determine provider mount slugs; keep them aligned with /mnt/memory/user and workspace.
/** Mount-path slug → `/mnt/memory/user/`. */
export const USER_STORE_NAME = 'user';
/** Mount-path slug → `/mnt/memory/workspace/`. */
export const WORKSPACE_STORE_NAME = 'workspace';

export const USER_STORE_DESCRIPTION = (userName: string): string =>
  `Personal preferences and context for ${userName}.`;

export const WORKSPACE_STORE_DESCRIPTION =
  'Shared facts about this organization, its standards, and its work.';

// Instructions say what belongs in each store, not when to read it; the platform supplies mount
// metadata and the agent chooses when memory is relevant. Leave room for the capped file index.
export const USER_STORE_INSTRUCTIONS =
  "The user's personal memory. It is authoritative for tone, formatting, and personal context. Write personal preferences, working style, and names of people or projects the user references often. Organization-wide facts belong in the workspace store.";

export const WORKSPACE_STORE_INSTRUCTIONS =
  'Shared workspace memory for organization-wide facts: team conventions, recurring vendors, clients, projects, and shared workflows. Personal preferences belong in the user store.';

// The sessions API caps each attachment's `instructions` at 4096 characters;
// every append below respects it by returning the input unchanged when the
// addition would not fit.
export const STORE_INSTRUCTIONS_MAX_CHARS = 4096;

const LISTING_LEAD = ' Files in this store as of session start: ';
const EMPTY_STORE_NOTE =
  ' This store is currently empty; there is nothing to read at session start.';

// Include known paths to avoid an initial listing command; omit the suffix if even one path cannot fit.
export function appendMemoryFileListing(instructions: string, paths: string[]): string {
  if (paths.length === 0) {
    const withNote = instructions + EMPTY_STORE_NOTE;
    return withNote.length <= STORE_INSTRUCTIONS_MAX_CHARS ? withNote : instructions;
  }
  // Reserve space for the worst-case truncation marker so a greedy include
  // never has to backtrack.
  const marker = `, …and ${paths.length} more`;
  const budget =
    STORE_INSTRUCTIONS_MAX_CHARS - instructions.length - LISTING_LEAD.length - marker.length - 1; // trailing period
  let listing = '';
  let included = 0;
  for (const path of paths) {
    const candidate = listing === '' ? path : `${listing}, ${path}`;
    if (candidate.length > budget) break;
    listing = candidate;
    included += 1;
  }
  if (included === 0) return instructions;
  const remaining = paths.length - included;
  const tail = remaining > 0 ? `, …and ${remaining} more.` : '.';
  return `${instructions}${LISTING_LEAD}${listing}${tail}`;
}
