'use client';

import type { WebSource } from '../../lib/tool-display-details';
import { SourceFavicon } from './source-favicon';

// The unfolded detail of a web search: one small pill per website, favicon +
// host, each a link to the first page that site returned. This row is the ONE
// place in tool rendering with a fill behind text, and it is the quietest fill
// the palette has.

export function SourceChips({ sources }: { sources: WebSource[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid="source-chips">
      {sources.map((source) => (
        <li key={source.host} className="min-w-0 max-w-full">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            title={source.title}
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-button bg-alpha-6 py-1 pl-2 pr-2.5 text-meta font-medium text-muted-foreground transition-colors duration-150 [@media(hover:hover)]:hover:bg-alpha-8 [@media(hover:hover)]:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            <SourceFavicon host={source.host} className="size-3.5" />
            <span className="min-w-0 truncate">{source.host}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
