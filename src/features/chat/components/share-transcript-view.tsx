'use client';

import { useState } from 'react';
import { IconMessageChatCircle, IconZap } from '@/components/icons';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Message, MessageContent, MessageGroup } from '@/components/ui/message';
import { cn } from '@/lib/utils';
import type { PublicTranscriptItem, PublicTranscriptTool } from '../types';
import { AssistantMessage } from './assistant-message';
import { MessageAttachments } from './message-attachments';
import { ToolChain } from './tool-chain';
import { ActivityLine, LineBody } from './tool-renderers/activity-line';

const COLLAPSE_CHARS = 700;
const COLLAPSE_LINES = 12;

/** Only the server's explicit public projection crosses this client boundary. */
export function ShareTranscriptView({
  workspaceName,
  title,
  items,
}: {
  workspaceName: string;
  title: string;
  items: PublicTranscriptItem[];
}) {
  const turns: PublicTranscriptItem[][] = [];
  for (const item of items) {
    if (!turns.length || (item.kind === 'message' && item.role === 'user')) turns.push([]);
    turns.at(-1)?.push(item);
  }
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1.5 border-b pb-5">
        <p className="text-meta font-medium text-muted-foreground">{workspaceName}</p>
        <h1 className="text-title-section font-semibold">{title}</h1>
        <p className="text-meta text-muted-foreground">Shared read-only</p>
      </header>
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <IconMessageChatCircle className="size-6 text-muted-foreground" />
          <p className="text-body font-medium">No messages yet</p>
          <p className="text-meta text-muted-foreground">This thread is empty</p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col">
          {turns.map((turn, index) => (
            <PublicTurn key={index} items={turn} />
          ))}
        </div>
      )}
    </main>
  );
}

function isFoldedTool(item: PublicTranscriptItem): item is PublicTranscriptTool {
  return item.kind === 'tool' && item.status !== 'gated' && item.status !== 'denied';
}

function PublicTurn({ items }: { items: PublicTranscriptItem[] }) {
  const steps = items.filter(isFoldedTool);
  const standalone = items.filter((item): boolean => !isFoldedTool(item));
  const user =
    standalone[0]?.kind === 'message' && standalone[0].role === 'user'
      ? standalone.shift()
      : undefined;
  return (
    <MessageGroup className="gap-3 pb-3">
      {user?.kind === 'message' ? <PublicMessage item={user} /> : null}
      {steps.length ? <ToolChain readOnly steps={steps} /> : null}
      {standalone.map((item, index) =>
        item.kind === 'message' ? (
          <PublicMessage key={index} item={item} />
        ) : item.status === 'gated' ? (
          <div key={index}>
            <ActivityLine icon={<IconZap className="size-4" />} text={item.title} status="gated" />
            <LineBody>
              <section
                aria-label="Approval required"
                className="flex w-full max-w-xl flex-col gap-3 rounded-xl bg-alpha-3 px-4 py-3"
              >
                <p className="text-body-lg font-medium text-foreground">Approval required</p>
              </section>
            </LineBody>
          </div>
        ) : (
          <ActivityLine
            key={index}
            icon={<IconZap className="size-4" />}
            text={item.title}
            status={item.status}
            badge={item.status === 'denied' ? 'Denied' : null}
          />
        ),
      )}
    </MessageGroup>
  );
}

function PublicMessage({ item }: { item: Extract<PublicTranscriptItem, { kind: 'message' }> }) {
  const files = (
    <MessageAttachments
      entries={item.fileNames.map((name) => ({ kind: 'file', name, url: null }))}
    />
  );
  if (item.role === 'assistant')
    return (
      <>
        {item.text ? <AssistantMessage text={item.text} /> : null}
        {files}
      </>
    );
  return (
    <Message align="end">
      <MessageContent className="items-end gap-1.5">
        {files}
        {item.text ? <PublicUserBubble text={item.text} /> : null}
      </MessageContent>
    </Message>
  );
}

// Shared Message/Bubble primitives provide the app's geometry without mounting
// its private copy/timestamp controls on an anonymous page.
function PublicUserBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = text.length > COLLAPSE_CHARS || text.split('\n').length > COLLAPSE_LINES;
  const collapsed = collapsible && !expanded;
  return (
    <Bubble variant="default" align="end" className="items-end">
      <BubbleContent className="rounded-xl p-0">
        <p
          className={cn(
            'whitespace-pre-wrap break-words px-4 py-2.5 text-body-lg',
            collapsed && 'max-h-52 overflow-hidden',
          )}
        >
          {text}
        </p>
        {collapsed ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-bl-xl bg-gradient-to-t from-primary to-transparent" />
        ) : null}
      </BubbleContent>
      {collapsible ? (
        <Button
          variant="link"
          size="xs"
          className="h-auto p-0 text-meta font-medium text-foreground underline underline-offset-2"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      ) : null}
    </Bubble>
  );
}
