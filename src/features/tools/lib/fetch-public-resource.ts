import { IntegrationError, ToolError } from '@/lib/errors';
import { type RedirectState, receiveRedirect } from './redirect-machine';

export async function fetchPublicResource(
  rawUrl: string,
  limit: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  assertTarget: (url: URL) => Promise<unknown>,
): Promise<{ response: Response; url: URL }> {
  if (!URL.canParse(rawUrl) || new URL(rawUrl).protocol !== 'https:')
    throw new ToolError('TOOL_INPUT_INVALID', 'The resource URL must use HTTPS', { url: rawUrl });
  let state: RedirectState = { kind: 'requesting', url: new URL(rawUrl), redirects: 0 };
  while (state.kind === 'requesting') {
    await assertTarget(state.url);
    let response: Response;
    try {
      response = await fetchImpl(state.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Could not fetch resource bytes',
        { url: state.url.toString() },
        { cause },
      );
    }
    try {
      state = receiveRedirect(state, response, limit);
    } finally {
      if (response.status >= 300 && response.status < 400) await response.body?.cancel();
    }
  }
  return { response: state.response, url: state.url };
}
