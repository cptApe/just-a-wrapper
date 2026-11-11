'use client';

import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { peekCreateHandoff, subscribeCreateHandoff } from '@/features/sessions/lib/create-handoff';
import { UserMessage } from './user-message';
import { WorkingIndicator } from './working-indicator';

const TASK_PATH_PATTERN =
  /^\/app\/task\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

type PendingThreadMessage = { localId: string; text: string };

/** The optimistic opening turn shown by the task loading boundary. */
function PendingCreateThread({
  text,
  queued = [],
}: {
  text: string;
  queued?: PendingThreadMessage[];
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col px-4 py-6">
      <div className="flex min-h-[calc(100dvh-16rem)] flex-col gap-3 pb-3">
        <UserMessage text={text} />
        <WorkingIndicator />
        {queued.map((entry) => (
          <div
            key={entry.localId}
            className="duration-150 animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
          >
            <UserMessage text={entry.text} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TaskLoadingThread() {
  const pathname = usePathname();
  const sessionId = pathname.match(TASK_PATH_PATTERN)?.[1];
  return sessionId ? <HandoffThread key={sessionId} sessionId={sessionId} /> : null;
}

/** Follows the Home-to-task handoff without consuming ChatView's seed. */
function HandoffThread({ sessionId }: { sessionId: string }) {
  const handoff = useSyncExternalStore(
    (listener) => subscribeCreateHandoff(sessionId, listener),
    () => peekCreateHandoff(sessionId),
    () => null,
  );
  if (!handoff) return null;

  return <PendingCreateThread text={handoff.text} queued={handoff.queued} />;
}
