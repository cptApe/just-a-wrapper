import 'server-only';
import {
  buildExaContentsRequest,
  ExaContentsResponseSchema,
  type FetchPageInput,
  FetchPageInputSchema,
  type FetchPageOutput,
  FetchPageOutputSchema,
  toFetchPageOutput,
} from '@/features/tool-catalog/lib/exa-contents';
import type { CustomTool } from '@/features/tool-catalog/types';
import { FETCH_PAGE_DECL } from '@/features/tool-catalog/web-declarations';
import { ToolError } from '@/lib/errors';
import { exaCapability } from '@/lib/runtime-capabilities';
import { callExa } from '../lib/exa-request';
import { blockedTargetReason } from '../lib/url-guard';
import { vendorCallEstimateCredits } from '../lib/vendor-estimates';

// Executor for `fetch_page`, a built-in page-reading ability on our Exa key, never a connectable
// app. web_search_exa finds sources, fetch_page reads them (summary and highlights by default, full
// text on request), browse_page drives a real browser. A failed URL degrades to a `failed` row and
// never fails the call. `livecrawl` and `context` are deprecated by Exa and not sent; freshness
// rides on `maxAgeHours`. Schemas and projection live in tool-catalog/lib/exa-contents; this module
// owns the SSRF gate, and callExa owns the HTTP call and the reported cost the dispatcher bills.

// This module loads only for a declared tool; capture its provider credentials once.
const { apiKey } = exaCapability();

export const fetchPageTool: CustomTool<FetchPageInput, FetchPageOutput> = {
  ...FETCH_PAGE_DECL,
  inputSchema: FetchPageInputSchema,
  outputSchema: FetchPageOutputSchema,
  measureVendorCostCents: (_input, output) => output.vendorCostCents,
  estimateCredits: vendorCallEstimateCredits,
  async handler(input) {
    const { urls, mode } = input;
    // SSRF gate per URL, same policy as browse_page: Exa crawls from its own
    // network, but loopback/private/link-local hosts and non-web schemes are
    // never legitimate page reads.
    for (const url of urls) {
      const blocked = blockedTargetReason(url);
      if (blocked) {
        throw new ToolError('TOOL_INPUT_INVALID', `Cannot read that URL: ${blocked}`, { url });
      }
    }

    const { parsed, vendorCostCents } = await callExa({
      endpoint: 'contents',
      apiKey,
      body: buildExaContentsRequest(input),
      schema: ExaContentsResponseSchema,
    });
    return toFetchPageOutput(parsed, mode, vendorCostCents);
  },
};
