import { IconChevronRight } from '@/components/icons';
import { cn } from '@/lib/utils';
import { registryEntryText } from '../lib/prompt-admin-content';
import type { PromptRegistryEntry } from '../prompt-registry';
import { PromptTextBlock } from './prompt-text-block';

export function PromptEntryCard({ title, entry }: { title: string; entry: PromptRegistryEntry }) {
  return (
    <details id={entry.id} className="group/prompt scroll-mt-24 rounded-lg border bg-card">
      <summary
        className={cn(
          'flex min-h-14 cursor-pointer select-none list-none items-center gap-3 rounded-lg px-4 py-3',
          'text-title-card hover:bg-alpha-6 [&::-webkit-details-marker]:hidden',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <IconChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[var(--ease-out)] motion-reduce:transition-none group-open/prompt:rotate-90"
        />
        <span>{title}</span>
      </summary>
      <div className="border-t p-4">
        <PromptTextBlock text={registryEntryText(entry)} className="max-h-72 overflow-y-auto" />
      </div>
    </details>
  );
}
