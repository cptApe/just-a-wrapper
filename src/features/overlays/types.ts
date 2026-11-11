import type { OverlayHash } from './lib/tokens';

// Hash-overlay types connect URL tokens, the global host and registered components.

/** What the host passes every overlay. Overlays are self-sufficient: `id` +
    `params` come from the hash and are the overlay's ONLY inputs — it loads its
    own data from them, which is what lets it open over any /app route. */
export type OverlayComponentProps = {
  /** The `<id>` segment of `#token/<id>` — null for id-less tokens. */
  id: string | null;
  /** Hash params (`#file/x?in=/Reports` → in=/Reports). */
  params: URLSearchParams;
  /** False while the close animation plays; the host unmounts shortly after. */
  open: boolean;
  /** Close = pop the pushState entry (or strip the hash on a cold deep link) —
      the host owns the history semantics, overlays just call this. */
  onClose: () => void;
  /** Refine the overlay in place (prev/next through a set) — replaces the hash
      with no new history entry, so back still means "leave", never "undo". */
  onReplaceHash: (hash: OverlayHash) => void;
};

/** A successfully parsed overlay hash. */
export type ParsedOverlay<Token extends string = string> = {
  token: Token;
  id: string | null;
  params: URLSearchParams;
};
