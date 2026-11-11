import { ToolError } from '@/lib/errors';

export type RedirectState =
  | { kind: 'requesting'; url: URL; redirects: number }
  | { kind: 'received'; url: URL; response: Response };

export function receiveRedirect(
  state: RedirectState,
  response: Response,
  limit: number,
): RedirectState {
  if (state.kind === 'received') return state;
  if (response.status < 300 || response.status >= 400)
    return { kind: 'received', url: state.url, response };
  const location = response.headers.get('location');
  if (!location || state.redirects >= limit || !URL.canParse(location, state.url))
    throw new ToolError('TOOL_INPUT_INVALID', 'The resource returned an invalid redirect', {
      url: state.url.toString(),
    });
  const url = new URL(location, state.url);
  if (url.protocol !== 'https:')
    throw new ToolError('TOOL_INPUT_INVALID', 'The resource URL must use HTTPS', {
      url: url.toString(),
    });
  return { kind: 'requesting', url, redirects: state.redirects + 1 };
}
