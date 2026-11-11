// Vercel Functions reject request bodies over 4.5 MB, and UTF-8 needs at most three bytes per
// UTF-16 unit. Anthropic documents no text block limit, only 32 MB per Sessions request.
export const MAX_INLINE_TEXT_CHARS = 1_000_000;

// File and skill references join the message after the person's text and never count against them.
export const MAX_MESSAGE_CHARS = MAX_INLINE_TEXT_CHARS + 100_000;

// Longer text travels as an attached file.
export const LONG_TEXT_ATTACHMENT_CHARS = 10_000;

export const INLINE_LIMIT_NOTICE =
  'This is too long to send without file uploads. Send it in smaller parts, or ask your admin to turn on file storage.';

export function longTextFile(text: string): File {
  return new File([text], 'Pasted text.txt', { type: 'text/plain' });
}
