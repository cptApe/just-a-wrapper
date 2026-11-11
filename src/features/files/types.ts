import type { ActionState } from '@/lib/action-state';
// Shared types for the files feature. Plain types only — safe to
// import from both server and client modules.

export type FileEntry = {
  id: string;
  filename: string;
  folderPath: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  source: 'user_upload' | 'agent_generated' | 'session_output';
  createdAt: string; // ISO
  /** Set for Recently-deleted listings; live reads leave it null/absent. */
  deletedAt?: string | null;
};

export type FolderEntry = {
  id: string;
  path: string;
  name: string;
  createdAt: string; // ISO
  /** Set for Recently-deleted listings; live reads leave it null/absent. */
  deletedAt?: string | null;
};

export type ShareMode = 'view' | 'edit';

export type ShareTarget =
  | { kind: 'folder'; folderPath: string }
  | { kind: 'file'; fileId: string; filename: string };

export type ResolvedShare =
  | { status: 'not_found' | 'revoked' | 'expired' }
  | ({ status: 'live'; workspaceId: string; workspaceName: string } & (
      | { kind: 'folder'; mode: ShareMode; folderPath: string; files: FileEntry[] }
      | { kind: 'file'; mode: 'view'; file: FileEntry }
    ));

// Listed to anyone who can see the target, so it carries no token; only the
// creator receives the URL, once, from createShare.
export type ShareSummary = {
  canRevoke: boolean;
  fileId: string | null;
  id: string;
  folderPath: string;
  mode: ShareMode;
  /** What a visitor gets now, from the same check the public link runs. */
  state: 'live' | 'revoked' | 'expired';
  createdAt: string;
};

export type UploadConfig =
  | { enabled: true; uploadTag: string; maxFileBytes: number }
  | { enabled: false; reason: string };

// Server-action result. Internally everything throws (hard rule); the action
// boundary turns a thrown AppError into this client-safe shape so the UI can
// toast constraint/validation failures instead of crashing.
export type ActionResult<T = undefined> = ActionState<T>;

// Feature-local types for agent file outputs ("artifacts"). The DB row
// (src/db/schema/artifact.ts) mirrors Anthropic Files API metadata; these are
// the client-facing projections the routes return and the components render.

/** How the ArtifactViewer renders a given artifact. Derived, never stored. */
export type ArtifactKind =
  | 'markdown'
  | 'code'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'csv'
  | 'html'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'unknown';

/** One artifact as the routes serialize it (timestamps as ISO strings). */
export type ArtifactSummary = {
  id: string;
  /** Provider file id correlates inline references with artifact rows. */
  anthropicFileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** False for files the Files API refuses to serve (non-agent-created). */
  downloadable: boolean;
  /** Set once "Save to Knowledge" has copied this artifact into the drive. */
  savedDriveFileId: string | null;
  /** The Files API's created_at — when the agent actually produced the file. */
  createdAt: string;
};

/** Library grouping: a session's artifacts under its title + date. */
export type ArtifactSessionGroup = {
  /** Local session row id — the grouping key (always unique, even unrelayed). */
  sessionRowId: string;
  /** Anthropic session id, internal to the relay; null if never relayed. */
  anthropicSessionId: string | null;
  title: string | null;
  sessionCreatedAt: string;
  artifacts: ArtifactSummary[];
};

/** Library projection for the authorized task's file picker. */
export type SessionLibraryFile = Pick<
  ArtifactSummary,
  'id' | 'filename' | 'mimeType' | 'sizeBytes' | 'createdAt'
> & {
  /** Durable CDN URL of the library upload; image rows use it as a thumbnail. */
  url: string;
};

export type SessionFile =
  | (SessionLibraryFile & { kind: 'library' })
  | (ArtifactSummary & { kind: 'artifact' });
