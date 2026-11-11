// One store of composer drafts, keyed by where the composer sits. A task's key is its session
// id, and its text (with the cursor) survives reloads in localStorage. Home's keys start with
// '#' and live only in memory. A draft outlives its composer so a failed send can restore into
// it while the composer is gone; the next composer on that key shows it.

import { z } from 'zod';
import { captureException } from '@/lib/observability-client';
import {
  type ComposerDraft,
  type ComposerDraftEvent,
  EMPTY_COMPOSER_DRAFT,
  reduceComposerDraft,
} from './composer-draft';

/** The Home composer. */
export const HOME_DRAFT_KEY = '#home';
/** The composer under a Home opening while its chat is created. */
export const OPENING_DRAFT_KEY = '#opening';

/** The session a draft belongs to, or undefined for Home's drafts. */
export function sessionIdOfDraft(key: string): string | undefined {
  return key.startsWith('#') ? undefined : key;
}

const storedSchema = z.object({ text: z.string(), cursorStart: z.number(), cursorEnd: z.number() });
type StoredText = z.infer<typeof storedSchema>;
const STORAGE_PREFIX = 'just-a-wrapper:draft:';

const drafts = new Map<string, ComposerDraft>();
const cursors = new Map<string, { start: number; end: number }>();
const listeners = new Map<string, Set<() => void>>();
const holders = new Map<string, number>();

// Report storage trouble once per page load, not once per keystroke.
let storageFailureReported = false;

function readStored(sessionId: string): StoredText | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + sessionId);
    if (!raw) return null;
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    // Unreadable storage (private mode, corrupted entry) behaves as no draft.
    if (!storageFailureReported) captureException(error, { op: 'chat.draft-storage-read' });
    storageFailureReported = true;
    return null;
  }
}

function writeStored(sessionId: string, text: string): void {
  if (typeof window === 'undefined') return;
  const cursor = cursors.get(sessionId) ?? { start: text.length, end: text.length };
  try {
    if (text.length === 0) window.localStorage.removeItem(STORAGE_PREFIX + sessionId);
    else
      window.localStorage.setItem(
        STORAGE_PREFIX + sessionId,
        JSON.stringify({ text, cursorStart: cursor.start, cursorEnd: cursor.end }),
      );
  } catch (error) {
    // Quota or private mode: the in-memory draft still covers this tab.
    if (!storageFailureReported) captureException(error, { op: 'chat.draft-storage-write' });
    storageFailureReported = true;
  }
}

function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

export function readComposerDraft(key: string): ComposerDraft {
  const draft = drafts.get(key);
  if (draft) return draft;
  const sessionId = sessionIdOfDraft(key);
  const stored = sessionId ? readStored(sessionId) : null;
  if (!stored) return EMPTY_COMPOSER_DRAFT;
  const loaded = { ...EMPTY_COMPOSER_DRAFT, text: stored.text };
  drafts.set(key, loaded);
  cursors.set(key, { start: stored.cursorStart, end: stored.cursorEnd });
  return loaded;
}

export function subscribeComposerDraft(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
  };
}

/** Returns whether the draft moved. */
export function dispatchComposerDraft(key: string, event: ComposerDraftEvent): boolean {
  const current = readComposerDraft(key);
  const next = reduceComposerDraft(current, event);
  if (next === current) return false;
  drafts.set(key, next);
  const sessionId = sessionIdOfDraft(key);
  if (next.text !== current.text) {
    if (event.type !== 'text') cursors.set(key, { start: next.text.length, end: next.text.length });
    if (sessionId) writeStored(sessionId, next.text);
  }
  notify(key);
  return true;
}

/** Typed or inserted text, with where the cursor ends up (the end unless the textarea says). */
export function setComposerText(
  key: string,
  text: string,
  cursor: { start: number; end: number } = { start: text.length, end: text.length },
): void {
  cursors.set(key, cursor);
  dispatchComposerDraft(key, { type: 'text', text });
}

/** Every failed send puts its draft back through here, whether or not a composer shows the key. */
export function restoreComposerDraft(key: string, draft: ComposerDraft): void {
  dispatchComposerDraft(key, { type: 'restore', draft });
}

/** Empty the draft and hand back what it held. */
export function takeComposerDraft(key: string): ComposerDraft {
  const draft = readComposerDraft(key);
  dispatchComposerDraft(key, { type: 'clear' });
  return draft;
}

export function readDraftCursor(key: string): { start: number; end: number } {
  readComposerDraft(key);
  const text = drafts.get(key)?.text ?? '';
  return cursors.get(key) ?? { start: text.length, end: text.length };
}

/** The textarea's selection, saved with a task's text so a reload puts the cursor back. */
export function rememberDraftCursor(key: string, start: number, end: number): void {
  cursors.set(key, { start, end });
  const sessionId = sessionIdOfDraft(key);
  if (sessionId) writeStored(sessionId, readComposerDraft(key).text);
}

/**
 * A mounted composer holds its key. When the last holder lets go, the files and picks go
 * with it, as they did when they lived in the component; a task keeps its text. The check
 * waits a microtask so React's development remount and a hand-over between two composers
 * on one key do not drop anything.
 */
export function holdComposerDraft(key: string): () => void {
  holders.set(key, (holders.get(key) ?? 0) + 1);
  return () => {
    holders.set(key, (holders.get(key) ?? 1) - 1);
    queueMicrotask(() => {
      if ((holders.get(key) ?? 0) > 0) return;
      holders.delete(key);
      dispatchComposerDraft(key, { type: sessionIdOfDraft(key) ? 'release' : 'clear' });
    });
  };
}

/** The task was deleted: its draft has nowhere to go. */
export function discardDraft(sessionId: string): void {
  drafts.delete(sessionId);
  cursors.delete(sessionId);
  writeStored(sessionId, '');
  notify(sessionId);
}

/** A workspace switch: Home's drafts belong to the workspace that was left. */
export function resetHomeDrafts(): void {
  for (const key of [HOME_DRAFT_KEY, OPENING_DRAFT_KEY]) {
    if (drafts.delete(key)) notify(key);
  }
}
