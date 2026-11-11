// The sidebar and layout host mount separately; a window event lets either open the shared menu.
const OPEN_EVENT = 'just-a-wrapper:command-search-open';

/** Ask the mounted command menu to open. */
export function openCommandSearch(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Subscribe to open requests; returns the unsubscribe for effect cleanup. */
export function onCommandSearchOpen(listener: () => void): () => void {
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

/** True on Apple platforms — picks the ⌘K vs Ctrl+K hint and shortcut. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
