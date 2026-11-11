import { ChatLoadingFrame } from './chat-loading-frame';
import { TaskLoadingComposer } from './task-loading-composer';
import { TaskLoadingThread } from './task-loading-thread';

// The /app/task/[id] route-level loading fallback: the real chrome paints
// instantly while the page resolves its session row — the header in its
// loading form, the Home handoff's optimistic turn when one exists (otherwise
// the message area stays blank), and the composer fully INTERACTIVE (never
// skeletoned) — draft-keyed by the task id from the URL, so what you type
// here is what the live composer holds when ChatView mounts.
export function ChatViewSkeleton() {
  return (
    <ChatLoadingFrame label="Loading task" composer={<TaskLoadingComposer />}>
      <TaskLoadingThread />
    </ChatLoadingFrame>
  );
}
