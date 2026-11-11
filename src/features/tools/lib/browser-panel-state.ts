import { z } from 'zod';
export const browserPanelViewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({
    status: z.literal('live'),
    browserbaseSessionId: z.string(),
    debuggerFullscreenUrl: z.string(),
    url: z.string().nullable(),
    title: z.string().nullable(),
    browserStatus: z.enum(['active', 'acting', 'user', 'closing']),
  }),
  z.object({
    status: z.literal('ended'),
    browserbaseSessionId: z.string(),
    replayUrl: z.string(),
    url: z.string().nullable(),
    title: z.string().nullable(),
  }),
]);
export type BrowserPanelView = z.infer<typeof browserPanelViewSchema>;

export type BrowserPanelState =
  | { kind: 'loading' }
  | {
      kind: 'live';
      browserbaseSessionId: string;
      debuggerFullscreenUrl: string;
      url: string | null;
      title: string | null;
      browserStatus: 'active' | 'acting' | 'user' | 'closing';
      controlRequest: 'idle' | 'pending';
    }
  | {
      kind: 'ended';
      browserbaseSessionId: string;
      replayUrl: string;
      url: string | null;
      title: string | null;
    }
  | { kind: 'error' };

export type BrowserPanelAction =
  | { type: 'load' }
  | { type: 'loaded'; view: BrowserPanelView }
  | { type: 'control_started' }
  | { type: 'control_finished' }
  | { type: 'take_control' }
  | { type: 'hand_back' }
  | { type: 'disconnected'; replayUrl: string }
  | { type: 'error' }
  | { type: 'poll_failed' };

export const INITIAL_BROWSER_PANEL_STATE: BrowserPanelState = { kind: 'loading' };

/** The Live View URL as embedded. Browserbase's live view "includes a navbar
 * at the top" by default and documents `${liveViewLink}&navbar=false` to hide
 * it (docs.browserbase.com/features/session-live-view); hidden here because
 * the panel header already shows the page title and address. Appended textually rather than
 * through URLSearchParams: the URL's `wss` value itself carries a `?t=` token
 * that re-serialization would percent-encode. */
export function liveViewSrc(debuggerFullscreenUrl: string): string {
  return `${debuggerFullscreenUrl}${debuggerFullscreenUrl.includes('?') ? '&' : '?'}navbar=false`;
}

/** "iana.org/help/example-domains" for the header meta line: the scheme, a
 * leading `www.` (as the chat's host labels do) and a bare trailing slash are
 * dropped; path, query and fragment are kept so the address stays accurate. */
export function displayAddress(url: string | null): string | null {
  if (!url || !URL.canParse(url)) return url;
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
  const host = parsed.host.replace(/^www\./, '');
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${host}${path}${parsed.search}${parsed.hash}`;
}

export function reduceBrowserPanel(
  state: BrowserPanelState,
  action: BrowserPanelAction,
): BrowserPanelState {
  switch (action.type) {
    case 'load':
      return INITIAL_BROWSER_PANEL_STATE;
    case 'loaded':
      if (action.view.status === 'none') return INITIAL_BROWSER_PANEL_STATE;
      if (action.view.status === 'ended') {
        return {
          kind: 'ended',
          browserbaseSessionId: action.view.browserbaseSessionId,
          replayUrl: action.view.replayUrl,
          url: action.view.url,
          title: action.view.title,
        };
      }
      return {
        kind: 'live',
        browserbaseSessionId: action.view.browserbaseSessionId,
        debuggerFullscreenUrl:
          state.kind === 'live' && state.browserbaseSessionId === action.view.browserbaseSessionId
            ? state.debuggerFullscreenUrl
            : action.view.debuggerFullscreenUrl,
        url: action.view.url,
        title: action.view.title,
        browserStatus: action.view.browserStatus,
        controlRequest: state.kind === 'live' ? state.controlRequest : 'idle',
      };
    case 'control_started':
      return state.kind === 'live' ? { ...state, controlRequest: 'pending' } : state;
    case 'control_finished':
      return state.kind === 'live' ? { ...state, controlRequest: 'idle' } : state;
    case 'take_control':
      return state.kind === 'live' ? { ...state, browserStatus: 'user' } : state;
    case 'hand_back':
      return state.kind === 'live' ? { ...state, browserStatus: 'active' } : state;
    case 'disconnected':
      return state.kind === 'live'
        ? {
            kind: 'ended',
            browserbaseSessionId: state.browserbaseSessionId,
            replayUrl: action.replayUrl,
            url: state.url,
            title: state.title,
          }
        : state;
    case 'poll_failed':
      return state.kind === 'live' ? state : { kind: 'error' };
    case 'error':
      return { kind: 'error' };
  }
}

export function nextBrowserPanelPoll(status: 'none' | 'live' | 'retry', attempts: number) {
  const nextAttempts = status === 'live' ? 0 : attempts + 1;
  return {
    attempts: nextAttempts,
    delay: nextAttempts >= 40 ? null : status === 'none' ? 750 : 5_000,
  };
}
