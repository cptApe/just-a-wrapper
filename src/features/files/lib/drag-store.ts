type DragState = { kind: 'idle' } | { kind: 'dragging'; keys: ReadonlySet<string> };

let state: DragState = { kind: 'idle' };
let timeout: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
export function subscribeDrag(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function dragSnapshot() {
  return state;
}
const idle: DragState = { kind: 'idle' };
export function serverDragSnapshot() {
  return idle;
}
function end() {
  clearTimeout(timeout);
  window.removeEventListener('drop', end);
  window.removeEventListener('dragend', end);
  window.removeEventListener('dragover', bump);
  state = { kind: 'idle' };
  for (const listener of listeners) listener();
}
function bump() {
  clearTimeout(timeout);
  timeout = setTimeout(end, 1500);
}
export function beginDrag(keys: string[]) {
  state = { kind: 'dragging', keys: new Set(keys) };
  window.addEventListener('drop', end);
  window.addEventListener('dragend', end);
  window.addEventListener('dragover', bump);
  bump();
  for (const listener of listeners) listener();
}
