// Which frame the Home route renders while a send is in flight. Pure so the
// one-render race below stays unit tested.
//
// After the create call returns, Home sets the opening session id and pushes
// /app/task/<id> in the same tick, but the router's pathname catches up one
// render later. In that render the chat frame cannot match (no task id yet)
// and a pending-frame rule keyed on the router path alone falls through to the
// plain Home page, whose composer sits mid-page: a one-frame layout jump. The
// browser's own location is already the task path in that render, so "the
// person went back to Home" is only true when both paths say /app.

type HomeFrame = 'chat' | 'pending' | 'home';

export function homeFrameFor(input: {
  /** Task id parsed from the router pathname, if on /app/task/<id>. */
  taskId: string | undefined;
  /** The session row already opened in place for that task id. */
  openedSession: boolean;
  /** A send is in flight (the pending frame's sent text). */
  pending: boolean;
  /** The session id the create call returned, if any. */
  openingSessionId: string | null;
  /** The router's pathname (lags pushState by one render). */
  routerPath: string;
  /** window.location.pathname (already updated by pushState). */
  locationPath: string;
}): HomeFrame {
  if (input.taskId && (input.openedSession || input.openingSessionId !== input.taskId)) {
    return 'chat';
  }
  if (!input.pending || input.openedSession) return 'home';
  const wentBackHome =
    input.openingSessionId !== null && input.routerPath === '/app' && input.locationPath === '/app';
  return wentBackHome ? 'home' : 'pending';
}
