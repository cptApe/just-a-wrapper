// Never stack overlay history; open pushes once, refine replaces. Native history APIs integrate with the App Router (see node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md).
import { parseOverlayHash } from './hash';
import { type OverlayHistoryState, overlayHistoryReducer } from './overlay-history-machine';
import { OVERLAY_TOKENS, type OverlayHash } from './tokens';

const OVERLAY_SYNC_EVENT = 'just-a-wrapper:overlay-sync';

let state: OverlayHistoryState = { kind: 'cold' };
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const closeGuards = new Map<symbol, string>();

export function preventOverlayClose(): () => void {
  const token = Symbol();
  closeGuards.set(token, window.location.href);
  return () => {
    closeGuards.delete(token);
  };
}

/** The current hash without its '#', '' when none. */
export function readOverlayHash(): string {
  return window.location.hash.replace(/^#/, '');
}

function urlWithHash(hash: OverlayHash | ''): string {
  const url = new URL(window.location.href);
  url.hash = hash;
  return url.toString();
}

// Next router navigation changes the URL without emitting hashchange; callers notify the store after commit.
export function syncOverlayHash(): void {
  window.dispatchEvent(new Event(OVERLAY_SYNC_EVENT));
}

/** Open an overlay. Pushes ONE history entry for the layered state; while an
    overlay is already open the new one replaces it in that same entry, so
    Close and Back always land on the page underneath. */
export function openOverlay(hash: OverlayHash): void {
  if (state.kind === 'closing') {
    state = overlayHistoryReducer(state, { type: 'queue', hash });
    return;
  }
  if (closeGuards.size > 0) return;
  const currentHash = readOverlayHash();
  if (parseOverlayHash(currentHash, OVERLAY_TOKENS) !== null) {
    window.history.replaceState(null, '', urlWithHash(hash));
    syncOverlayHash();
    return;
  }
  window.history.pushState(null, '', urlWithHash(hash));
  state = overlayHistoryReducer(state, { type: 'opened' });
  syncOverlayHash();
}

/** Refine the open overlay in place (e.g. list → item) — no history entry. */
export function replaceOverlayHash(hash: OverlayHash): void {
  window.history.replaceState(null, '', urlWithHash(hash));
  syncOverlayHash();
}

// Before a page navigation, strip the hash instead of popping: a pending pop would race the new history entry.
export function closeOverlayInPlace(): void {
  if (closeGuards.size > 0) return;
  state = overlayHistoryReducer(state, { type: 'cleared' });
  if (closeTimer !== null) clearTimeout(closeTimer);
  if (window.location.hash === '') return;
  window.history.replaceState(null, '', urlWithHash(''));
  syncOverlayHash();
}

/** Close the open overlay per the semantics above. A no-op while nothing is
    open or while a pop-close is still landing. */
export function closeOverlay(): void {
  if (
    closeGuards.size > 0 ||
    state.kind === 'closing' ||
    parseOverlayHash(readOverlayHash(), OVERLAY_TOKENS) === null
  )
    return;
  if (state.kind === 'open') {
    // popstate will re-sync subscribers (and clear the in-flight flag).
    state = overlayHistoryReducer(state, { type: 'close' });
    closeTimer = setTimeout(() => {
      if (state.kind !== 'closing') return;
      const queued = state.queued;
      closeOverlayInPlace();
      if (queued !== null) openOverlay(queued);
    }, 250);
    window.history.back();
    return;
  }
  window.history.replaceState(null, '', urlWithHash(''));
  syncOverlayHash();
}

/** Subscribe to every way the hash can change: native hash navigation
    (anchors), back/forward, and our own programmatic calls. Returns the
    unsubscribe for effect cleanup. */
export function subscribeOverlayHash(onChange: (hash: string) => void): () => void {
  const sync = () => onChange(readOverlayHash());
  const onHistoryTraversal = () => {
    const guardedUrl = closeGuards.values().next().value;
    if (guardedUrl !== undefined && window.location.href !== guardedUrl) {
      window.history.pushState(null, '', guardedUrl);
      sync();
      return;
    }
    const queued = state.kind === 'closing' ? state.queued : null;
    if (closeTimer !== null) clearTimeout(closeTimer);
    state = overlayHistoryReducer(state, {
      type: 'traversed',
      overlay: parseOverlayHash(readOverlayHash(), OVERLAY_TOKENS) !== null,
    });
    if (queued !== null) {
      openOverlay(queued);
      return;
    }
    sync();
  };
  window.addEventListener('hashchange', onHistoryTraversal);
  window.addEventListener('popstate', onHistoryTraversal);
  window.addEventListener(OVERLAY_SYNC_EVENT, sync);
  return () => {
    window.removeEventListener('hashchange', onHistoryTraversal);
    window.removeEventListener('popstate', onHistoryTraversal);
    window.removeEventListener(OVERLAY_SYNC_EVENT, sync);
  };
}
