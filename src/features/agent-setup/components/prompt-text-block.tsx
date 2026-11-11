import { cn } from '@/lib/utils';

// The reading surface for prompt text. Everything here is text a model reads, so
// it is rendered verbatim in a monospace block: no markdown pass, no syntax
// highlighting, no smart quotes. The persona sections are wrapped in XML-style
// tags (<role>, <examples>), and React escapes them for us, which the markdown
// renderer elsewhere in the app does not.
//
// `whitespace-pre-wrap` keeps the authored line breaks (they are load-bearing in
// the prompts) while still wrapping to the column, so nothing scrolls sideways.

export function PromptTextBlock({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={cn(
        'whitespace-pre-wrap break-words rounded-md bg-alpha-6 p-4',
        'font-mono text-meta leading-[1.75] text-foreground/90',
        className,
      )}
    >
      {text}
    </pre>
  );
}
