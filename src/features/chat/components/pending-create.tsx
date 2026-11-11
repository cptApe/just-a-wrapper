'use client';
import type { ReactNode } from 'react';
import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';
import { ChatLoadingFrame } from './chat-loading-frame';
import { UserMessage } from './user-message';
import { WorkingIndicator } from './working-indicator';

export function PendingCreate({
  text,
  attachments,
  composer,
}: {
  text: string;
  attachments: OptimisticComposerAttachment[];
  composer: ReactNode;
}) {
  return (
    <ChatLoadingFrame label="Starting task" composer={composer}>
      <div className="mx-auto flex max-w-3xl flex-col px-4 py-6">
        <div className="flex min-h-[calc(100dvh-16rem)] flex-col gap-3 pb-3">
          <UserMessage text={text} attachments={attachments} />
          <WorkingIndicator />
        </div>
      </div>
    </ChatLoadingFrame>
  );
}
