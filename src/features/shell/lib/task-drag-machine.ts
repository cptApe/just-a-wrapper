type DraggedTask = { id: string; favorited: boolean };
type DropZone = 'pinned' | 'recents';
export type TaskDragState =
  | { kind: 'idle' }
  | { kind: 'dragging'; task: DraggedTask; target: DropZone | null };
export type TaskDragEvent =
  | { type: 'start'; task: DraggedTask }
  | { type: 'target'; target: DropZone | null }
  | { type: 'finish' };
export function taskDragReducer(state: TaskDragState, event: TaskDragEvent): TaskDragState {
  switch (event.type) {
    case 'start':
      return { kind: 'dragging', task: event.task, target: null };
    case 'target':
      return state.kind === 'dragging' ? { ...state, target: event.target } : state;
    case 'finish':
      return { kind: 'idle' };
  }
}
