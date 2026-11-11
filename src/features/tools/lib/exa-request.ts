import 'server-only';
import type { z } from 'zod';
import { IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { PaidToolError } from './paid-tool-error';

// The one HTTP call behind web_search_exa and fetch_page (exa.ai/docs/reference/search and
// /get-contents). Exa reports the real per-request cost at `costDollars.total` in USD.

const EXA_DYNAMIC_HIGHLIGHTS_BETA = 'dynamic-highlights-2026-08-28';
// Page reads with subpages are Exa's slowest calls; past this the agent gets an error, not a hang.
const EXA_TIMEOUT_MS = 60_000;
const FAILURE_MESSAGES = {
  search: 'Exa web search failed',
  contents: 'Exa page read failed',
} as const;

/** Exa's reported cost in cents, or null when the response carries none. */
function exaCostCents(json: unknown): number | null {
  if (typeof json !== 'object' || json === null || !('costDollars' in json)) return null;
  const cost = json.costDollars;
  if (typeof cost !== 'object' || cost === null || !('total' in cost)) return null;
  const total = cost.total;
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total * 100 : null;
}

/**
 * POST one Exa request and parse the slice of the answer the tool reads. Exa answered and
 * charged once it returns JSON, so a shape mismatch still bills through `PaidToolError`. A
 * response without a cost bills nothing and is reported, because the customer goes unbilled.
 */
export async function callExa<Parsed>(input: {
  endpoint: 'search' | 'contents';
  apiKey: string;
  body: unknown;
  schema: z.ZodType<Parsed>;
}): Promise<{ parsed: Parsed; vendorCostCents: number }> {
  const context = { endpoint: input.endpoint };
  const failed = FAILURE_MESSAGES[input.endpoint];
  let response: Response;
  try {
    response = await fetch(`https://api.exa.ai/${input.endpoint}`, {
      method: 'POST',
      headers: {
        'x-api-key': input.apiKey,
        'content-type': 'application/json',
        'Exa-Beta': EXA_DYNAMIC_HIGHLIGHTS_BETA,
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(EXA_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new IntegrationError('EXTERNAL_API_FAILED', failed, context, { cause });
  }
  if (!response.ok) {
    const body = await response.text().catch((cause: unknown) => {
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        failed,
        { ...context, status: response.status },
        { cause },
      );
    });
    throw new IntegrationError('EXTERNAL_API_FAILED', failed, {
      ...context,
      status: response.status,
      body: body.slice(0, 500),
    });
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Exa response was not valid JSON',
      { ...context, status: response.status },
      { cause },
    );
  }
  const reported = exaCostCents(json);
  if (reported === null) {
    captureException(
      new IntegrationError('EXTERNAL_API_FAILED', 'Exa response carried no cost', context),
    );
  }
  const vendorCostCents = reported ?? 0;
  const parsed = input.schema.safeParse(json);
  if (!parsed.success) {
    throw new PaidToolError({
      cost: { vendorCostCents },
      message: 'Exa returned an unexpected response shape',
      context: { ...context, issues: parsed.error.flatten() },
    });
  }
  return { parsed: parsed.data, vendorCostCents };
}
