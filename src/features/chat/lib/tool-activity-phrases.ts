import { plural } from '@/lib/format/plural';
import { connectedAppDoneLine } from './connected-app-outcome';
import { recordOf } from './record-of';
import type { ToolResultView } from './tool-display-activity';
import { parseResultObject } from './tool-result-data';
import { hostLabel } from './url-display';

type Forms = {
  running: string;
  done: string;
  base: string;
  groupSubject?: string;
};

export type Phrase = (input: Record<string, unknown>, result: ToolResultView | undefined) => Forms;

export const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;

/** A URL's host reads better than the full address on a one-line card. */
export function hostOf(v: unknown): string | undefined {
  const url = str(v);
  return url === undefined ? undefined : hostLabel(url);
}

/** The distinct hosts behind a list of URLs, first-seen order. One website can
 *  return several pages; the count the line quotes is websites, not pages. */
export function uniqueHosts(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const hosts: string[] = [];
  for (const url of urls) {
    const host = hostOf(url);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/** The Library root reads as "your Library", deeper paths as the folder name. */
export function libraryFolderOf(v: unknown): string | undefined {
  const path = str(v);
  if (!path || path === '/') return undefined;
  const segments = path.split('/').filter(Boolean);
  return segments.at(-1);
}

export function fileNameOf(v: unknown): string | undefined {
  const path = str(v);
  if (!path) return undefined;
  const segments = path.split('/').filter(Boolean);
  return segments.at(-1);
}

export function parentFolderOf(v: unknown): string | undefined {
  const path = str(v);
  if (!path) return undefined;
  const segments = path.split('/').filter(Boolean);
  return segments.length >= 2 ? segments[segments.length - 2] : undefined;
}

/** "your Library" at the root, "your Notes folder" anywhere deeper. */
export function libraryPlace(folder: string | undefined): string {
  return folder ? `your ${folder} folder` : 'your Library';
}

/** The parsed object of a successful JSON result, else null. */
export function okData(result: ToolResultView | undefined): Record<string, unknown> | null {
  if (!result || result.isError) return null;
  return parseResultObject(result.text);
}

export function directConnectedAppDone(
  slug: string,
  input: Record<string, unknown>,
  result: ToolResultView | undefined,
): string | null {
  const envelope = okData(result);
  if (
    !envelope ||
    envelope.blocked === true ||
    envelope.successful !== true ||
    !('data' in envelope)
  ) {
    return null;
  }
  return connectedAppDoneLine(slug, input, envelope.data);
}

export function singleBatchDone(
  slug: string,
  input: Record<string, unknown>,
  result: ToolResultView | undefined,
): string | null {
  const envelope = okData(result);
  if (!envelope || envelope.blocked === true) return null;
  const data = recordOf(envelope.data);
  if (!Array.isArray(data?.results)) return null;
  const row =
    data.results.map(recordOf).find((candidate) => candidate?.tool_slug === slug) ??
    recordOf(data.results[0]);
  const response = recordOf(row?.response);
  if (response?.successful !== true || !('data' in response)) return null;
  return connectedAppDoneLine(slug, input, response.data);
}

/** Three forms that share one object of the sentence. */
export function forms(running: string, done: string, base: string): Forms {
  return { running, done, base };
}

/** The common "verb + object" trio: `[Reading, Read, read] plan.md`. */
export function verbForms(
  verbs: [running: string, done: string, base: string],
  object: string,
  suffix = '',
): Forms {
  return {
    ...forms(
      `${verbs[0]} ${object}${suffix}`,
      `${verbs[1]} ${object}${suffix}`,
      `${verbs[2]} ${object}${suffix}`,
    ),
    groupSubject: object,
  };
}

export const READ: [string, string, string] = ['Reading', 'Read', 'read'];

export const EDIT: [string, string, string] = ['Editing', 'Edited', 'edit'];

export const WRITE: [string, string, string] = ['Writing', 'Wrote', 'write'];

export const WORK_ON: [string, string, string] = ['Working on', 'Worked on', 'work on'];

export const fileOr = (input: Record<string, unknown>, fallback: string) =>
  fileNameOf(input.path ?? input.file_path) ?? fallback;

/** How many web pages a `fetch_page` call asked for, phrased. */
export function pagesLabel(urls: unknown): string {
  const list = Array.isArray(urls) ? urls : [];
  if (list.length === 1) return hostOf(list[0]) ?? 'a web page';
  if (list.length === 0) return 'web pages';
  return plural(list.length, 'web page');
}

/** The folder a move lands in: a destination that names a file (has an
 *  extension) means its parent folder; a bare folder destination means itself.
 *  Undefined at the Library root, which `libraryPlace` reads as "your Library". */
export function destinationFolderOf(toPath: unknown): string | undefined {
  const path = str(toPath);
  if (!path) return undefined;
  const segments = path.split('/').filter(Boolean);
  const last = segments.at(-1);
  const namesFile = last !== undefined && /\.[A-Za-z0-9]{1,8}$/.test(last);
  const folders = namesFile ? segments.slice(0, -1) : segments;
  return folders.at(-1);
}
