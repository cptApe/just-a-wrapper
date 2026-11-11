// History can be empty, unavailable, or contain any number of turns. Keep the
// thread's flex slot, without inventing a user message or assistant response.
export function ChatThreadSkeleton() {
  return (
    <div
      className="min-h-0 flex-1 overflow-hidden"
      role="status"
      aria-busy="true"
      aria-label="Loading messages"
    />
  );
}
