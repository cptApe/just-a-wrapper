import type { Icon } from '@/components/icons';

/** One workspace member, projected for author chips on a shared thread. */
export type ThreadMember = { userId: string; name: string; image: string | null };

/** What the user message renders above its bubble: avatar and first name. */
export type AuthorChip = { name: string; image: string | null };

// View-only public task-link summary, separate from workspace sharing.

/** A session_share row projected for the client (share menu). */
export type SessionShareSummary = {
  id: string;
  sessionId: string;
  token: string;
  /** The public `/share/<token>` URL, precomputed server-side. */
  url: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** One row of the public read-only transcript. Tool calls carry only
 * display metadata, never arguments or result content. Projected
 * server-side so raw tool input never reaches the client bundle. */
export type PublicTranscriptItem =
  | { kind: 'message'; role: 'user' | 'assistant'; text: string; fileNames: string[] }
  | PublicTranscriptTool;

/** Only server-projected presentation data, never a raw call or result. */
export type PublicTranscriptTool = {
  kind: 'tool';
  /** Name-only icon lookup; arguments and results stay server-side. */
  tool: string;
  title: string;
  status: 'done' | 'failed' | 'gated' | 'denied' | 'blocked' | 'interrupted' | 'paused';
  reply: number;
  durationMs?: number;
  /** Each original work run contributes its span once, avoiding overlap. */
  workDurationMs?: number;
};

// Shared in-memory banners show one persistent actionable condition above the composer.
// The registry chooses the highest-priority candidate, with no database persistence.

/** Fixed priority order for the one-banner-at-a-time rule: billing > connection
 *  > workspace. Only 'billing' has a producer at launch; the others exist so the
 *  registry can carry them later without a shape change. */
export type ComposerBannerKind = 'billing' | 'connection' | 'workspace';

/** The primary action a banner offers (e.g. "Add credits"). Optional — a banner with
 *  no action is still allowed, but the launch set only ships actionable ones. */
type ComposerBannerAction = { label: string; onSelect: () => void };

/** A banner candidate held in the client-side registry. `id` is stable per
 *  condition (e.g. 'credits-exhausted') so re-firing replaces rather than
 *  stacks. `onDismiss` is an OPTIONAL producer side-effect — the registry owns
 *  the actual hide-for-the-session removal, so most producers omit it. */
export type ComposerBanner = {
  id: string;
  kind: ComposerBannerKind;
  icon: Icon;
  message: string;
  action?: ComposerBannerAction;
  onDismiss?: () => void;
};

export type ComposerCreditsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; creditBalance: number; hasPlan: boolean }
  | { kind: 'off' };
