import { PromptTextBlock } from './prompt-text-block';

// Renders the prompt verbatim, because its whitespace and tags are what the agent receives.
export function PromptPersonalityDocument({ text }: { text: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-5 sm:px-6 sm:py-6">
      <PromptTextBlock text={text} className="rounded-none bg-transparent p-0" />
    </div>
  );
}
