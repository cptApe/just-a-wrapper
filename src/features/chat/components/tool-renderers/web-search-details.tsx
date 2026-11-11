'use client';

import { webSearchSources } from '../../lib/tool-result-data';
import { DefaultDetails } from './default-outcome';
import { SourceChips } from './source-chips';
import type { ToolRendererProps } from './tool-renderer-types';

// Native `web_search` returns Anthropic search-result content blocks. The relay
// preserves those blocks as JSON text, and the unfolded detail reduces them to
// the same distinct-domain chips used by the Exa searcher. An error or any
// off-contract text stays visible through the default detail.

export function WebSearchDetails({ item }: ToolRendererProps) {
  if (!item.result) return null;
  const sources = webSearchSources(item.result);
  if (!sources) return <DefaultDetails item={item} />;
  return <SourceChips sources={sources} />;
}
