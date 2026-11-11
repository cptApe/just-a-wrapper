import { z } from 'zod';
import { captureException } from '@/lib/observability-client';
import type { ThemeEditState, ThemeEditValues } from '../types';
import { themeEditReducer } from './theme-edit-machine';
import { EMPTY_THEME_EDIT_VALUES, hasThemeEdits } from './theme-values';

// Storage failures retain this tab’s draft; corrupt saved drafts start inactive.
const THEME_EDIT_STORAGE_KEY = 'admin:theme-edit';
const THEME_EDIT_STORAGE_VERSION = 2;

type VersionedThemeEditState = ThemeEditState & { version: number };

export const INACTIVE_THEME_EDIT_STATE: ThemeEditState = {
  active: false,
  ...EMPTY_THEME_EDIT_VALUES,
};

let current: ThemeEditState | null = null;
const listeners = new Set<() => void>();
// Report storage trouble once per page load, not once per keystroke.
let storageFailureReported = false;

const storedStateSchema = z.object({
  // Version 1 drafts predate the current shape but still load: they carry no extra fields.
  version: z.union([z.literal(1), z.literal(THEME_EDIT_STORAGE_VERSION)]),
  active: z.boolean(),
  light: z.record(z.string(), z.string()),
  dark: z.record(z.string(), z.string()),
});

function parseState(raw: string | null): ThemeEditState {
  if (!raw) return INACTIVE_THEME_EDIT_STATE;
  const parsed = storedStateSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return INACTIVE_THEME_EDIT_STATE;
  const { active, light, dark } = parsed.data;
  return { active, light, dark };
}

function loadStored(): ThemeEditState {
  if (typeof window === 'undefined') return INACTIVE_THEME_EDIT_STATE;
  try {
    return parseState(window.localStorage.getItem(THEME_EDIT_STORAGE_KEY));
  } catch (error) {
    // Unreadable or corrupted entry — behave as "not editing".
    if (!storageFailureReported) {
      storageFailureReported = true;
      captureException(error, { op: 'theme.edit-storage-read' });
    }
    return INACTIVE_THEME_EDIT_STATE;
  }
}

/** Referentially stable between writes, so it is safe as a store snapshot. */
export function readThemeEditState(): ThemeEditState {
  if (current === null) current = loadStored();
  return current;
}

export function subscribeThemeEditState(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab exiting or editing — re-read so every tab agrees.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_EDIT_STORAGE_KEY) return;
    current = loadStored();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function writeThemeEditState(next: ThemeEditState): void {
  current = next;
  try {
    if (!next.active && !hasThemeEdits(next)) {
      window.localStorage.removeItem(THEME_EDIT_STORAGE_KEY);
    } else {
      const stored: VersionedThemeEditState = { version: THEME_EDIT_STORAGE_VERSION, ...next };
      window.localStorage.setItem(THEME_EDIT_STORAGE_KEY, JSON.stringify(stored));
    }
  } catch (error) {
    // Quota/private mode — the in-memory state still drives this tab.
    if (!storageFailureReported) {
      storageFailureReported = true;
      captureException(error, { op: 'theme.edit-storage-write' });
    }
  }
  for (const listener of listeners) listener();
}

/** Enter edit mode, restoring any draft left by an earlier session. */
export function activateThemeEdit(): void {
  writeThemeEditState(themeEditReducer(readThemeEditState(), { type: 'activate' }));
}

/** Leave edit mode but keep the draft so re-entering restores it. */
export function deactivateThemeEdit(): void {
  writeThemeEditState(themeEditReducer(readThemeEditState(), { type: 'deactivate' }));
}

export function updateThemeEditValues(update: (current: ThemeEditValues) => ThemeEditValues): void {
  const state = readThemeEditState();
  if (!state.active) return;
  const next = update({ light: state.light, dark: state.dark });
  writeThemeEditState(themeEditReducer(state, { type: 'update', values: next }));
}

export function discardThemeEditDraft(): void {
  writeThemeEditState(themeEditReducer(readThemeEditState(), { type: 'discard' }));
}

/** Drop draft keys absent from parsed theme tokens so stale drafts cannot
 * pin the saved-draft indicator or emit unused declarations. Write only on change. */
export function pruneThemeEditDraft(tokenNames: readonly string[]): void {
  const known = new Set(tokenNames);
  const state = readThemeEditState();
  const prune = (record: Partial<Record<string, string>>) =>
    Object.fromEntries(Object.entries(record).filter(([name]) => known.has(name)));
  const light = prune(state.light);
  const dark = prune(state.dark);
  const unchanged =
    Object.keys(light).length === Object.keys(state.light).length &&
    Object.keys(dark).length === Object.keys(state.dark).length;
  if (unchanged) return;
  writeThemeEditState(themeEditReducer(state, { type: 'prune', values: { light, dark } }));
}
