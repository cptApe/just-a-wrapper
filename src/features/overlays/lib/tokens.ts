// History needs token names without importing the component registry and its entire feature graph.
export const OVERLAY_TOKENS = [
  'browser',
  'notifications',
  'file',
  'task-file',
  'memory',
  'app',
  'skill',
  'feedback',
  'new-schedule',
  'new-workspace',
  'new-folder',
  'new-note',
  'chart',
  'topup',
  'plans',
] as const;

export type OverlayToken = (typeof OVERLAY_TOKENS)[number];

/** A hash without its '#': a token, optionally followed by an id segment or a query. */
export type OverlayHash = OverlayToken | `${OverlayToken}/${string}` | `${OverlayToken}?${string}`;
