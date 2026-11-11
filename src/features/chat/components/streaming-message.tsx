'use client';

import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { MarkdownMessage } from '@/components/ui/markdown-message';
import { Message, MessageContent } from '@/components/ui/message';
import { useSmoothStreamText } from '../hooks/use-smooth-stream-text';
import { WorkingIndicator } from './working-indicator';

// Stream live reply text through the same markdown presentation as settled messages.
// Previews have no actions or files because those come from the buffered record.
// Use word pacing only; per-block DOM animations would restart on every parse.
export function StreamingMessage({ text }: { text: string }) {
  const shown = useSmoothStreamText(text);
  return (
    <Message align="start">
      <MessageContent className="gap-0">
        <Bubble variant="ghost" className="w-full max-w-full">
          <BubbleContent className="w-full max-w-full overflow-visible p-0">
            {/* The smoothing hook reveals the text gradually, so for its first
                beat there is nothing to show while the thread has already
                handed this slot over from the working indicator; keep the
                indicator here until the first characters land, so the reply
                never goes blank between "Working…" and its text. */}
            {shown ? (
              <MarkdownMessage text={shown} className="text-body-lg" streaming />
            ) : (
              <WorkingIndicator />
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
