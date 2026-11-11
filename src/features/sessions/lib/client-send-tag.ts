// Only server-added send identities may reconcile a browser's optimistic message.
const TAG = /<client_send_id\s+id="([0-9a-f-]{36})"\s*\/>/gi;
export function readClientSendTag(text: string) {
  const sendId = Array.from(text.matchAll(TAG)).at(-1)?.[1];
  return { sendId, text: text.replace(TAG, '').trim() };
}
export function tagClientSend(text: string, sendId: string | undefined): string {
  const clean = readClientSendTag(text).text;
  return sendId ? `${clean}\n<client_send_id id="${sendId}"/>` : clean;
}
