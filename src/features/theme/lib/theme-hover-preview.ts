// Hover previews are transient and never persisted; leaving the choice restores the saved draft.
export type ThemeHoverPreview = { name: string; value: string } | null;

let current: ThemeHoverPreview = null;
const listeners = new Set<() => void>();

export function setThemeHoverPreview(next: ThemeHoverPreview): void {
  current = next;
  for (const listener of listeners) listener();
}

export function getThemeHoverPreview(): ThemeHoverPreview {
  return current;
}

export function subscribeThemeHoverPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
