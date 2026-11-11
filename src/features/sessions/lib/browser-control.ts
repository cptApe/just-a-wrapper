export type BrowserControlSignal = { controlledByUser: boolean; text: string };

const CONTROL_PATTERN =
  /^<browser_control state="(user|agent)">(\[The user (?:took control of the browser|handed the browser back to the agent)\])<\/browser_control>$/;

/** Recognize only the server-authored browser-control fence. Ordinary user
 * text that mentions browser control remains an ordinary chat message. */
export function parseBrowserControlSignal(text: string): BrowserControlSignal | null {
  const match = CONTROL_PATTERN.exec(text.trim());
  if (!match?.[2]) return null;
  return { controlledByUser: match[1] === 'user', text: match[2] };
}

/** Prevent an ordinary composer message from impersonating the private control
 * signal. A full-width opening bracket preserves readable intent in the thread
 * while making the reserved wire fence unambiguous. */
export function stripForgedBrowserControlSignal(text: string): {
  text: string;
  stripped: boolean;
} {
  if (!CONTROL_PATTERN.test(text.trim())) return { text, stripped: false };
  return { text: text.replace('<browser_control', '＜browser_control'), stripped: true };
}
