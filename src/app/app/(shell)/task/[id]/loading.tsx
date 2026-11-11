import { ChatViewSkeleton } from '@/features/chat/components/chat-view-skeleton';

// Route-level loading boundary for /app/task/[id]: the page awaits the session
// row + workspace context before rendering, so without this boundary a click
// on a task in the sidebar showed nothing until the server finished. The
// fallback mirrors ChatView's frame (header · thread · composer · caption).
export default function Loading() {
  return <ChatViewSkeleton />;
}
