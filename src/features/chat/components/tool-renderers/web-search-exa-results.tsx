'use client';

import { webSourcesOf } from '../../lib/tool-display-details';
import { readExaSearchResults } from '../../lib/tool-result-data';
import { DefaultDetails } from './default-outcome';
import { SourceChips } from './source-chips';
import type { ToolRendererProps } from './tool-renderer-types';

// Unfolded detail for `web_search_exa`: what was looked for, then one chip per
// website the search came back with (the same distinct-host set the line
// counts). Titles ride the chips as tooltips; the pages are one click away.
// Errors and off-contract results fall back to the default detail so nothing
// renders silent.

export function WebSearchExaResults({ item }: ToolRendererProps) {
  if (!item.result) return null;
  const data = item.result.isError ? null : readExaSearchResults(item.result.text);
  if (!data) return <DefaultDetails item={item} />;
  const sources = webSourcesOf(data.results);

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="exa-results">
      <p className="min-w-0 break-words text-meta text-muted-foreground">
        {sources.length === 0 ? 'Nothing came up for' : 'Looked for'} “{data.query}”
      </p>
      <SourceChips sources={sources} />
    </div>
  );
}
