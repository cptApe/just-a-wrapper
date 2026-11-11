import { parseResultValue } from './tool-result-data';

/** Indent JSON object payloads while leaving ordinary text untouched. */
export function prettyJson(text: string): string {
  const value = parseResultValue(text);
  return value ? JSON.stringify(value, null, 2) : text;
}
