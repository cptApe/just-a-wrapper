import { home } from '@content/home';
import {
  IconChevronDown,
  IconCopy01,
  IconEdit05,
  IconFolder,
  IconLayersThree01,
  IconMenu05,
  IconShare01,
  IconThumbsDown,
  IconThumbsUp,
  IconVolumeMax,
} from '@/components/icons';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { ShimmerText } from '@/components/ui/shimmer-text';
import { ExtensionPreservingName } from '@/features/chat/components/extension-preserving-name';
import {
  composerChatColumnClass,
  composerChatWrapClass,
} from '@/features/chat/lib/composer-geometry';
import { FileKindIcon } from '@/features/files/components/file-kind-icon';
import { cn } from '@/lib/utils';
import { MockComposer } from './mock-composer';
import { SENT, settledTiming, stepTiming } from './workspace-timing';

const copy = home.workspace;

const REPLY_ACTIONS = [
  { key: 'copy', ActionIcon: IconCopy01 },
  { key: 'read-aloud', ActionIcon: IconVolumeMax },
  { key: 'thumbs-up', ActionIcon: IconThumbsUp },
  { key: 'thumbs-down', ActionIcon: IconThumbsDown },
];

/** One task, in the slots and sizes of the real thread. */
export function WorkspaceTask() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TaskHeader />
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pt-6">
          <UserTurn />
          <WorkLine />
          <AssistantTurn />
          <ReplyFile />
          <ReplyActions />
        </div>
      </div>
      <div className={composerChatWrapClass}>
        <div className={composerChatColumnClass}>
          <MockComposer placeholder={copy.taskPlaceholder} />
        </div>
      </div>
      <div className="px-4 pb-2">
        <div
          className={cn(
            composerChatColumnClass,
            'flex items-center justify-between gap-3 px-1 pt-1 text-foreground-tertiary text-meta md:px-5',
          )}
        >
          <span className="min-w-0 truncate">{copy.disclaimer}</span>
          <span className="shrink-0 max-md:hidden">{copy.mode}</span>
        </div>
      </div>
    </div>
  );
}

function TaskHeader() {
  return (
    <div className="flex shrink-0 items-center gap-1 px-3 py-2 md:px-4">
      <Button variant="ghost" size="icon" className="-ml-2 size-11 md:hidden">
        <IconMenu05 className="size-5" />
      </Button>
      <div className="flex min-w-0 flex-1 items-center">
        <span className="min-w-0 truncate px-2 py-1 font-medium text-body">{copy.activeTask}</span>
        <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="hidden items-center gap-1 md:flex">
        <Button variant="ghost" size="sm">
          <IconShare01 className="size-4" />
          {copy.share}
        </Button>
        <Button variant="ghost" size="icon-sm">
          <IconFolder className="size-4" />
        </Button>
      </div>
      <Button variant="ghost" size="icon" className="ml-auto size-11 md:hidden">
        <IconEdit05 className="size-5" />
      </Button>
    </div>
  );
}

function UserTurn() {
  return (
    <div style={SENT} className="landing-rise">
      <Message align="end">
        <MessageContent className="items-end">
          <Bubble variant="muted" align="end" className="items-end">
            <BubbleContent className="rounded-xl p-0">
              <p className="px-4 py-2.5 text-body-lg">{copy.ask}</p>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </div>
  );
}

// The live line and its settled sentence share one cell, so the swap stays in
// place, the way the real activity chain folds up when the work ends.
function WorkLine() {
  return (
    <div className="grid min-h-11 items-center text-body-lg text-muted-foreground *:col-start-1 *:row-start-1">
      {copy.workSteps.map((step, index) => (
        <span
          key={step}
          style={stepTiming(index)}
          className="landing-beat flex items-center gap-1 opacity-0"
        >
          <span className="mr-1 flex size-4 shrink-0 items-center justify-center">
            <IconLayersThree01 className="size-4" />
          </span>
          <ShimmerText>{step}</ShimmerText>
          <span className="font-medium text-foreground-tertiary text-meta tabular-nums">
            {index + 1} {index === 0 ? 'step' : 'steps'}
          </span>
        </span>
      ))}
      <span style={settledTiming(0)} className="landing-rise">
        {copy.workedFor}
      </span>
    </div>
  );
}

function AssistantTurn() {
  return (
    <div style={settledTiming(1)} className="landing-rise">
      <Message align="start">
        <MessageContent className="gap-0">
          <Bubble variant="ghost" className="w-full max-w-full">
            <BubbleContent className="w-full max-w-full overflow-visible p-0">
              <p className="text-body-lg leading-[1.625]">{copy.reply}</p>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </div>
  );
}

function ReplyFile() {
  return (
    <div style={settledTiming(2)} className="landing-rise pt-1">
      <div className="flex min-h-[60px] max-w-[32rem] min-w-0 items-center gap-3 rounded-xl border border-border px-3 py-2">
        <FileKindIcon mimeType={copy.fileMime} name={copy.fileName} className="size-6" />
        <span className="flex min-w-0 flex-1 flex-col">
          <ExtensionPreservingName
            name={copy.fileName}
            className="font-medium text-body text-foreground"
          />
          <span className="truncate text-meta text-muted-foreground">{copy.fileKind}</span>
        </span>
      </div>
    </div>
  );
}

function ReplyActions() {
  return (
    <div style={settledTiming(3)} className="landing-rise max-md:hidden">
      <MessageFooter className="px-0">
        {REPLY_ACTIONS.map(({ key, ActionIcon }) => (
          <Button key={key} variant="ghost" size="icon-sm">
            <ActionIcon className="size-4" />
          </Button>
        ))}
      </MessageFooter>
    </div>
  );
}
