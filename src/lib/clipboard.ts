import { captureException } from './observability-client';

// Plain-http non-localhost origins do not expose the async Clipboard API.
export const CLIPBOARD_ERROR_MESSAGE = 'Clipboard access failed. Check browser permissions.';

export async function copyPromisedTextToClipboard(text: Promise<string>): Promise<boolean> {
  const content = text.then((value) => new Blob([value], { type: 'text/plain' }));
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': content })]);
    return true;
  } catch (error) {
    // Copy failure leaves the content available; callers show a retryable error state.
    if (globalThis.isSecureContext) captureException(error, { op: 'clipboard-write' });
    // Consume content rejection even when the clipboard API is unavailable.
    await Promise.allSettled([content]);
    return false;
  }
}
