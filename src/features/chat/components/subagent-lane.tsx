'use client';

import { useState } from 'react';
import { IconUsers01 } from '@/components/icons';
import { MarkdownMessage } from '@/components/ui/markdown-message';
import type { ArtifactSummary } from '@/features/files/types';
import type { ChatItem } from '../lib/chat-state';
import { ToolCallBlock } from './tool-call-block';
import { useToolDecisionsView } from './tool-decisions-context';
import { ActivityLine, LineBody } from './tool-renderers/activity-line';

type SubagentItem = Extract<ChatItem, { type: 'subagent' }>;

// Render one collapsed subagent row at the thread’s first position.
// Expansion shows its messages; labels use plain language without raw thread ids.
// The row stays open while one of its calls waits on a decision, so the approval is never hidden.

export function SubagentLane({
  item,
  artifactsByFileId,
}: {
  item: SubagentItem;
  artifactsByFileId?: ReadonlyMap<string, ArtifactSummary>;
}) {
  const [open, setOpen] = useState(false);
  const { pending } = useToolDecisionsView();
  const needsDecision = item.entries.some(
    (entry) => entry.sub === 'tool' && pending.has(entry.item.id),
  );
  // A waiting decision holds the row open, and it stays open afterwards so the receipt stays.
  if (needsDecision && !open) setOpen(true);
  const settled = item.status === 'idle' || item.status === 'terminated';
  const line = settled ? 'Worked with a subagent' : 'Working with a subagent';
  return (
    <ActivityLine
      icon={<IconUsers01 className="size-4" />}
      text={line}
      status={settled ? 'done' : 'running'}
      expanded={open}
      onToggle={() => setOpen((value) => !value)}
      data-testid="subagent-lane"
    >
      {open ? (
        <LineBody className="animate-in gap-3 fade-in-0 duration-150 motion-reduce:animate-none">
          {item.entries.map((entry) => {
            switch (entry.sub) {
              case 'message':
                return (
                  <div key={entry.id} className="flex min-w-0 flex-col gap-1">
                    <span className="text-meta text-muted-foreground">
                      {entry.direction === 'sent' ? 'Input' : 'Output'}
                    </span>
                    <MarkdownMessage text={entry.text} />
                  </div>
                );
              case 'tool':
                return (
                  <div key={entry.id} className="flex min-w-0 flex-col gap-2 pl-4">
                    <ToolCallBlock
                      item={entry.item}
                      artifactsByFileId={artifactsByFileId}
                      live={!settled}
                    />
                  </div>
                );
              case 'status':
                return null;
              default: {
                const unhandled: never = entry;
                return unhandled;
              }
            }
          })}
        </LineBody>
      ) : null}
    </ActivityLine>
  );
}
