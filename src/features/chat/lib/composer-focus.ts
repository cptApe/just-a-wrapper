// The one contract between the sidebar's "New task" action and the Home page.
// A window CustomEvent, not a store: the two sides live in different features
// and share nothing else, so an event keeps the coupling to this file.
//
// Home stays mounted after a send: it moves the URL to /app/task/<id> with a
// raw history push and renders the chat in place. A New task link back to /app
// then changes the URL without re-rendering Home, so the page would keep
// showing the task just sent. New task therefore asks the mounted Home page to
// reset itself; only when no Home page is listening does the link navigate.

const NEW_TASK_EVENT = 'just-a-wrapper:home-new-task';

/**
 * Ask the mounted Home page to start a fresh task: clear any opening in
 * progress, put the URL back on /app, and focus the composer. Returns false
 * when no Home page is mounted, so the caller navigates instead.
 */
export function requestHomeNewTask(): boolean {
  const event = new CustomEvent(NEW_TASK_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Subscribe to New task requests. The listener must call `preventDefault` on
 *  the event to signal that it handled the request. */
export function onHomeNewTaskRequest(listener: (event: Event) => void): () => void {
  window.addEventListener(NEW_TASK_EVENT, listener);
  return () => window.removeEventListener(NEW_TASK_EVENT, listener);
}
