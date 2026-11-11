import type { ReactNode } from 'react';
import { composerBottomSafeAreaClass } from '../lib/composer-geometry';
import { ChatHeaderSkeleton } from './chat-header-skeleton';
import { ComposerMetaRow } from './composer-meta-row';

// Share task loading geometry between route loading and Home’s pending create.
// Use the neutral header and a real composer supplied by the caller.
// The message area is empty while history loads or shows optimistic content on send.
// Keep this frame server-safe.
export function ChatLoadingFrame({
  children,
  label,
  composer,
}: {
  children?: ReactNode;
  label?: string;
  /** The live composer for this surface — never a skeleton. */
  composer: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col" aria-busy={label ? true : undefined} aria-label={label}>
      <ChatHeaderSkeleton />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {/* The meta row rides here too (no plan yet — the label pops in when the
          live view takes over) so the composer's resting height matches the
          loaded page exactly: same row, same clearance, zero shift. */}
      <div className={composerBottomSafeAreaClass}>
        {composer}
        <ComposerMetaRow />
      </div>
    </div>
  );
}
