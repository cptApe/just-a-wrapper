// Leaf surface: hash grammar, tokens and history. The app shell owns the host and the registry.
export { buildOverlayHash, isOverlayHash, parseOverlayHash } from './lib/hash';
export {
  closeOverlay,
  closeOverlayInPlace,
  openOverlay,
  readOverlayHash,
  replaceOverlayHash,
  subscribeOverlayHash,
  syncOverlayHash,
} from './lib/overlay-history';
export { overlayRetentionReducer } from './lib/overlay-retention-machine';
export { OVERLAY_TOKENS, type OverlayHash, type OverlayToken } from './lib/tokens';
export type { OverlayComponentProps } from './types';
