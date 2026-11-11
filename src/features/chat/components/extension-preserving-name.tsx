import { cn } from '@/lib/utils';

/** Ellipsizes the stem while keeping the extension visible. The full name is the tooltip. */
export function ExtensionPreservingName({ name, className }: { name: string; className?: string }) {
  const match = /^(.*?)(\.[^.]+)$/.exec(name);
  return (
    <span
      className={cn('flex min-w-0 max-w-full max-md:inline max-md:wrap-anywhere', className)}
      title={name}
    >
      <span className="truncate max-md:whitespace-normal">{match?.[1] ?? name}</span>
      {match ? <span className="shrink-0">{match[2]}</span> : null}
    </span>
  );
}
