import { cn } from '@/lib/utils';
import type { CapabilityKey } from '../lib/environment-capabilities';

// The row never shows a value, its length or its prefix.

// A sentence ends at a period followed by a space and a capital letter, so an
// abbreviation like "e.g. this" stays on one line.
const SENTENCE_END = /(?<=\.)\s+(?=[A-Z])/;

function descriptionLines(envKey: CapabilityKey): string[] {
  const lines = envKey.description.split(SENTENCE_END);
  if (!envKey.isSet) {
    lines.push(`Without it: ${envKey.unset.charAt(0).toLowerCase()}${envKey.unset.slice(1)}.`);
  }
  return lines;
}

export function EnvKeyRow({ envKey, detail }: { envKey: CapabilityKey; detail?: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <code className="break-all font-mono text-meta text-foreground" translate="no">
          {envKey.name}
        </code>
        {descriptionLines(envKey).map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are static text derived from config, never reordered
          <p key={index} className="text-pretty text-meta text-muted-foreground">
            {line}
          </p>
        ))}
        {detail ? <p className="text-pretty text-meta text-muted-foreground">{detail}</p> : null}
      </div>
      <span className="shrink-0 text-meta text-muted-foreground">
        {envKey.isSet ? 'Set' : 'Not set'}
      </span>
      <span
        aria-hidden
        className={cn(
          'size-2 shrink-0 rounded-full border-[1.5px]',
          envKey.isSet
            ? 'border-success-strong bg-success-strong'
            : 'border-alpha-24 bg-transparent',
        )}
      />
    </li>
  );
}
