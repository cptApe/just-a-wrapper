import { z } from 'zod';

/** Dynamic groups the search api returns, in display order. */
const SERVER_SEARCH_GROUPS = ['task', 'library', 'memory', 'app', 'skill', 'scheduled'] as const;

export type ServerSearchGroup = (typeof SERVER_SEARCH_GROUPS)[number];

const SearchResultSchema = z.object({
  group: z.enum(SERVER_SEARCH_GROUPS),
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().nullable().optional(),
  /** Navigation target: a /app path, optionally carrying an overlay hash. */
  href: z.string().min(1),
  /** App-group only: the toolkit's real catalog logo (same source the Tools
      page uses). Null/absent → the row falls back to a monogram. */
  logoUrl: z.string().nullable().optional(),
});

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
});

export type ServerSearchResult = z.infer<typeof SearchResultSchema>;

/** Overlay tokens a static command may open (all registered in the overlay
    registry — deep-linkable dialogs, opened via the hash grammar). */
type StaticOverlayToken = 'new-schedule' | 'new-note' | 'new-folder' | 'new-workspace' | 'feedback';

/** A static, client-matched command: a settings page or a quick action. */
export type StaticCommand = {
  group: 'setting' | 'action';
  id: string;
  title: string;
  subtitle?: string;
  action: { type: 'navigate'; href: string } | { type: 'overlay'; token: StaticOverlayToken };
};

/** The client search state machine. Task-title results can be present while the
    slower server sources are loading or unavailable. */
export type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; results: ServerSearchResult[] }
  | { kind: 'success'; results: ServerSearchResult[] }
  | { kind: 'error'; message: string; results: ServerSearchResult[] };

export type SearchFilter = 'all' | 'task' | 'library' | 'app' | 'scheduled';
