import { exaCapability } from '@/lib/runtime-capabilities';
import 'server-only';
import { z } from 'zod';
import {
  buildExaSearchRequest,
  snippetFromExaResult,
  webSearchExaInputSchema,
} from '@/features/tool-catalog/custom-tools/web-search-exa-contract';
import type { CustomTool } from '@/features/tool-catalog/types';
import { WEB_SEARCH_EXA_DECL } from '@/features/tool-catalog/web-declarations';
import { callExa } from '../lib/exa-request';
import { vendorCallEstimateCredits } from '../lib/vendor-estimates';

// Run first-party Exa search and project results to compact source entries. callExa owns the
// HTTP call and the reported cost the dispatcher bills.

// This module loads only for a declared tool; capture its provider credentials once.
const { apiKey } = exaCapability();

const result = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  publishedDate: z.string().optional(),
});
const output = z.object({
  query: z.string(),
  results: z.array(result),
  /** Real vendor cost of this call in CENTS — the dispatcher bills it. */
  vendorCostCents: z.number(),
});

// The slice of Exa's response we read. A missing title or highlight degrades to a usable row;
// a drift in the results list itself surfaces.
const exaResponse = z.object({
  results: z.array(
    z.object({
      title: z.string().nullish(),
      url: z.string(),
      highlights: z.array(z.string()).nullish(),
      publishedDate: z.string().nullish(),
    }),
  ),
});

export const webSearchExaTool: CustomTool<
  z.infer<typeof webSearchExaInputSchema>,
  z.infer<typeof output>
> = {
  ...WEB_SEARCH_EXA_DECL,
  inputSchema: webSearchExaInputSchema,
  outputSchema: output,
  measureVendorCostCents: (_input, output) => output.vendorCostCents,
  estimateCredits: vendorCallEstimateCredits,
  async handler(input) {
    const { query } = input;

    const { parsed, vendorCostCents } = await callExa({
      endpoint: 'search',
      apiKey,
      body: buildExaSearchRequest(input),
      schema: exaResponse,
    });
    return {
      query,
      results: parsed.results.map((r) => ({
        title: r.title?.trim() || r.url,
        url: r.url,
        snippet: snippetFromExaResult(r),
        ...(r.publishedDate ? { publishedDate: r.publishedDate } : {}),
      })),
      vendorCostCents,
    };
  },
};
