import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { MarkdownMessage } from '@/components/ui/markdown-message';
import { Message, MessageContent } from '@/components/ui/message';

// Assistant turns use full-width bubble-free markdown. The action row and
// generated files belong to the turn tail, so this renders only the words.

export function AssistantMessage({ text }: { text: string }) {
  return (
    <Message align="start">
      <MessageContent className="gap-0">
        {/* Ghost bubble = no bubble: full width, no padding, no background. */}
        <Bubble variant="ghost" className="w-full max-w-full">
          <BubbleContent className="w-full max-w-full overflow-visible p-0">
            {/* text-body-lg: chat messages are primary content, so it beats the
                markdown default size and matches the user bubble. */}
            <MarkdownMessage text={text} className="text-body-lg" />
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
