import { z } from 'zod';
import {
  extractEmbeddedToolSlugs,
  TOOL_ROUTER_EXECUTOR,
  toolkitFromToolName,
} from '@/features/permissions/lib/resolve';
import { COMPOSIO_TOOLKIT_ALLOWLIST } from '@/lib/composio/toolkits';
import { plural } from '@/lib/format/plural';
import { connectedAppName } from './connected-app-outcome';
import { isCreditStopResult } from './credit-stop';
import { recordOf } from './record-of';
import { PHRASES } from './tool-activity-catalog';
import { directConnectedAppDone, singleBatchDone } from './tool-activity-phrases';
import { parseResultObject } from './tool-result-data';

/** Interrupted means no result in a stopped, paused or failed turn.
 * Blocked means the dispatcher returned successful blocked:true metadata
 * for a tool disabled by settings. */
export type ToolStatus =
  | 'paused'
  | 'running'
  | 'gated'
  | 'denied'
  | 'done'
  | 'failed'
  | 'interrupted'
  | 'blocked';

type ToolActivity = {
  /** Present-tense line while the call runs ("Searching the web"). */
  running: string;
  /** Past-tense line once it settles, quantified from the real result when the
   *  payload allows it ("Searched 5 websites"). */
  done: string;
  /** The bare infinitive ("search the web") the decision and failure lines are
   *  built from. Always lowercase-led. */
  base: string;
  /** The integration the action belongs to ("Gmail"), when derivable. */
  app?: string;
  /** Additional batched actions beyond the first (batch executor calls). */
  extraActions: number;
  /** The object named by the line (a host, file, folder, and so on). Calls
   *  only aggregate when this matches; absent means the tool has no subject. */
  groupSubject?: string;
};

/** The settled result as the phrase table sees it: the posted text plus its
 *  parsed object when the tool posted JSON. Absent while the call runs. */
export type ToolResultView = { isError: boolean; text: string };

type ToolStatusItem = {
  name?: string;
  result?: { isError: boolean; text?: string };
  confirmation?: 'allow' | 'deny';
};

const exitCodeSchema = z.union([z.number(), z.string().regex(/^-?\d+$/)]);
const bashExitSchema = z.union([
  z.object({ exitCode: exitCodeSchema }),
  z.object({ exit_code: exitCodeSchema }),
  z.object({ return_code: exitCodeSchema }),
]);

/** Bash reports a command's non-zero exit through the same `isError` bit as a
 * runner failure. Only failures that prevented the command from running count
 * as failed in the UI; command output remains a completed command. */
function isBashRunnerFailure(text: string | undefined): boolean {
  const value = text?.trim() ?? '';
  if (!value) return true;
  if (/^Command exited with code -?\d+\.?(?:\r?\n|$)/i.test(value)) return false;
  return !bashExitSchema.safeParse(parseResultObject(value)).success;
}

/** Whether a tool call represents a tool failure rather than a completed call. */
export function isFailedToolCall(item: ToolStatusItem): boolean {
  if (item.result?.isError !== true || isCreditStopResult(item.result)) return false;
  if (item.name !== 'bash') return true;
  return isBashRunnerFailure(item.result.text);
}

/**
 * Derive the line status from the store's tool item. Pure so the thread line,
 * the gallery and tests all read the same lifecycle. `live` is whether the
 * turn holding the call is still working: a resultless call in a settled turn
 * was interrupted, not running.
 */
export function toolStatusOf(
  item: ToolStatusItem,
  { pendingGate = false, live = true }: { pendingGate?: boolean; live?: boolean } = {},
): ToolStatus {
  if (item.result) {
    if (isCreditStopResult(item.result)) return 'paused';
    if (isFailedToolCall(item)) return 'failed';
    return isBlockedResult(item.result.text) ? 'blocked' : 'done';
  }
  if (item.confirmation === 'deny') return 'denied';
  if (pendingGate) return 'gated';
  return live ? 'running' : 'interrupted';
}

/** The dispatcher's answer for a switched-off tool (captured live):
 *  `{"blocked":true,"message":"The \"web_search_exa\" tool is turned off in
 *  your tool permissions, so it did not run. You can allow it in Settings
 *  under Tools."}` — posted as a NON-error result. */
function isBlockedResult(text: string | undefined): boolean {
  if (!text) return false;
  return parseResultObject(text)?.blocked === true;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The line the thread leads with for a given status. State is in the words. */
export function activityLine(activity: ToolActivity, status: ToolStatus): string {
  switch (status) {
    case 'paused':
      return `Paused before ${lowerFirst(activity.running)}`;
    case 'running':
      return activity.running;
    case 'done':
      return activity.done;
    case 'gated':
      return `Wants to ${activity.base}`;
    case 'failed':
    case 'blocked':
      return `Couldn't ${activity.base}`;
    case 'denied':
      return `Didn't ${activity.base}`;
    case 'interrupted':
      return `Didn't finish ${lowerFirst(activity.running)}`;
  }
}

/** The small inline badge that follows the phrase, only for the states where
 *  a person or a setting stopped the call. A failed call carries its meaning
 *  in the phrase alone ("Couldn't run a command"): the agent tried something
 *  and moved on, and a red mark would read as the product being broken. */
export function statusBadge(status: ToolStatus): string | null {
  if (status === 'denied') return 'Denied';
  if (status === 'blocked') return 'Turned off';
  return null;
}

/**
 * What a settled result should say when unfolded, as one readable sentence.
 * The dispatcher posts structured errors and blocked calls; a person reads the message, never
 * the code. Plain text results pass through untouched.
 */
export function resultMessageOf(result: ToolResultView): string {
  const data = parseResultObject(result.text);
  if (data && typeof data.message === 'string' && (result.isError || data.blocked === true)) {
    return data.message;
  }
  return result.text;
}

/**
 * Leading-verb conjugation for connected-app action slugs, so
 * `GMAIL_SEND_EMAIL` reads "Sending email" / "Sent email" / "send email". A
 * verb outside this table keeps the imperative base form in every tense —
 * safe, still human.
 */
const VERB_FORMS: Partial<Record<string, { running: string; done: string }>> = {
  add: { running: 'Adding', done: 'Added' },
  archive: { running: 'Archiving', done: 'Archived' },
  book: { running: 'Booking', done: 'Booked' },
  cancel: { running: 'Canceling', done: 'Canceled' },
  check: { running: 'Checking', done: 'Checked' },
  copy: { running: 'Copying', done: 'Copied' },
  create: { running: 'Creating', done: 'Created' },
  delete: { running: 'Deleting', done: 'Deleted' },
  download: { running: 'Downloading', done: 'Downloaded' },
  draft: { running: 'Drafting', done: 'Drafted' },
  edit: { running: 'Editing', done: 'Edited' },
  fetch: { running: 'Fetching', done: 'Fetched' },
  find: { running: 'Finding', done: 'Found' },
  forward: { running: 'Forwarding', done: 'Forwarded' },
  get: { running: 'Getting', done: 'Got' },
  insert: { running: 'Inserting', done: 'Inserted' },
  invite: { running: 'Inviting', done: 'Invited' },
  list: { running: 'Listing', done: 'Listed' },
  mark: { running: 'Marking', done: 'Marked' },
  move: { running: 'Moving', done: 'Moved' },
  open: { running: 'Opening', done: 'Opened' },
  post: { running: 'Posting', done: 'Posted' },
  query: { running: 'Looking up', done: 'Looked up' },
  read: { running: 'Reading', done: 'Read' },
  remove: { running: 'Removing', done: 'Removed' },
  reply: { running: 'Replying', done: 'Replied' },
  run: { running: 'Running', done: 'Ran' },
  save: { running: 'Saving', done: 'Saved' },
  schedule: { running: 'Scheduling', done: 'Scheduled' },
  search: { running: 'Searching', done: 'Searched' },
  send: { running: 'Sending', done: 'Sent' },
  set: { running: 'Setting', done: 'Set' },
  star: { running: 'Starring', done: 'Starred' },
  update: { running: 'Updating', done: 'Updated' },
  upload: { running: 'Uploading', done: 'Uploaded' },
  write: { running: 'Writing', done: 'Wrote' },
};

/**
 * Humanize one tool call into every form. The batch executor renders as its
 * underlying action(s) — users never see `COMPOSIO_MULTI_EXECUTE_TOOL`. The
 * settled result, when given, lets a done line quote a real count.
 */
export function describeToolActivity(
  name: string,
  input: Record<string, unknown>,
  result?: ToolResultView,
): ToolActivity {
  if (name === TOOL_ROUTER_EXECUTOR) {
    const slugs = extractEmbeddedToolSlugs(name, input);
    const firstSlug = slugs.at(0);
    if (firstSlug === undefined) {
      return {
        running: 'Using a connected app',
        done: 'Used a connected app',
        base: 'use a connected app',
        extraActions: 0,
      };
    }
    const first = describeSlug(firstSlug);
    const extra = slugs.length - 1;
    const more = extra > 0 ? ` and ${plural(extra, 'more action')}` : '';
    const firstAction = Array.isArray(input.tools)
      ? input.tools.map(recordOf).find((action) => action?.tool_slug === firstSlug)
      : null;
    const firstInput = recordOf(firstAction?.arguments) ?? {};
    const done =
      extra === 0 ? (singleBatchDone(firstSlug, firstInput, result) ?? first.done) : first.done;
    return {
      running: first.running + more,
      done: done + more,
      base: first.base + more,
      ...(first.app ? { app: first.app } : {}),
      extraActions: extra,
    };
  }
  const known = PHRASES.get(name);
  if (known) return { ...known(input, result), extraActions: 0 };
  const described = describeSlug(name);
  const done = toolkitSlugOf(name, {})
    ? (directConnectedAppDone(name, input, result) ?? described.done)
    : described.done;
  return { ...described, done, extraActions: 0 };
}

/**
 * Phrase a maximal consecutive run through the same table as an individual
 * call. Tools may supply a cleaner count-aware phrase; otherwise the last
 * call's running/done form gains a plain step count.
 */
export function aggregateActivityLine(
  activity: ToolActivity,
  state: 'running' | 'done',
  steps: number,
): string {
  const line = state === 'running' ? activity.running : activity.done;
  return `${line} · ${plural(steps, 'step')}`;
}

/**
 * Phrase a slug-style tool name. SCREAMING_SNAKE Composio slugs lead with the
 * action and name the app (`GMAIL_SEND_EMAIL` → "Sending email with Gmail");
 * anything else reads as sentence-case words in every form.
 */
export function describeSlug(slug: string): Omit<ToolActivity, 'extraActions'> {
  const known = PHRASES.get(slug);
  if (known) return known({}, undefined);
  const words = slug.split(/[_\-\s]+/).filter(Boolean);
  if (words.length === 0) return { running: slug, done: slug, base: slug };
  const isScreaming = slug === slug.toUpperCase() && words.length >= 2;
  if (isScreaming) {
    const toolkitSlug = toolkitSlugOf(slug, {});
    const resolvedToolkit = COMPOSIO_TOOLKIT_ALLOWLIST.find((toolkit) => toolkit === toolkitSlug);
    const app = connectedAppName(slug);
    const toolkitWordCount = resolvedToolkit?.split('_').length ?? 1;
    const action = words.slice(toolkitWordCount).map((w) => w.toLowerCase());
    const actionVerb = action.at(0);
    if (actionVerb === undefined) {
      return {
        running: `Using ${app}`,
        done: `Used ${app}`,
        base: `use ${app}`,
        app,
      };
    }
    const verb = VERB_FORMS[actionVerb];
    const rest = action.slice(1).join(' ');
    const withApp = ` with ${app}`;
    if (verb) {
      const object = rest ? ` ${rest}` : '';
      return {
        running: `${verb.running}${object}${withApp}`,
        done: `${verb.done}${object}${withApp}`,
        base: `${actionVerb}${object}${withApp}`,
        app,
      };
    }
    const base = sentenceCase(action);
    return {
      running: `${base}${withApp}`,
      done: `${base}${withApp}`,
      base: `${lowerFirst(base)}${withApp}`,
      app,
    };
  }
  const base = sentenceCase(words);
  return { running: base, done: base, base: lowerFirst(base) };
}

/**
 * The allowlisted toolkit slug a call belongs to ("gmail"), unwrapping the
 * batch executor to its first embedded action. The longest matching toolkit
 * prefix wins, so compound slugs such as ONE_DRIVE_* resolve to `one_drive`.
 */
export function toolkitSlugOf(name: string, input: Record<string, unknown>): string | undefined {
  const target = name === TOOL_ROUTER_EXECUTOR ? extractEmbeddedToolSlugs(name, input)[0] : name;
  if (!target) return undefined;
  return toolkitFromToolName(target, COMPOSIO_TOOLKIT_ALLOWLIST) ?? undefined;
}

export function sentenceCase(words: string[]): string {
  const lower = words.map((w) => w.toLowerCase());
  const first = lower.at(0);
  const rest = lower.slice(1);
  if (first === undefined) return '';
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/**
 * Plain-language line for a page `fetch_page` couldn't read. Exa reports a
 * terse failure tag ("crawl_timeout", "404", …); we translate it to a sentence
 * a non-technical user understands, always leading with the host so the row
 * says which page failed. The caller passes the already-formatted host (via
 * hostLabel) so the wording stays free of URL parsing.
 */
export function fetchFailureText(host: string, reason: string): string {
  return `Couldn't read ${host}. ${fetchFailureReason(reason)}`;
}

/** The one activity sentence for a folded browser run. */
export function browserGroupLine(host: string | undefined, running: boolean): string {
  const prefix = running ? 'Using the browser' : 'Used the browser';
  return host ? `${prefix} on ${host}` : prefix;
}

/** The friendly clause for a raw Exa failure tag; a generic fallback covers
 *  tags we haven't seen. Matches on keywords so tag spelling drift still maps. */
function fetchFailureReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('timeout') || r.includes('timed')) return 'The page took too long to respond.';
  if (r.includes('not_found') || r.includes('notfound') || r.includes('404')) {
    return 'The page could not be found.';
  }
  if (
    r.includes('forbidden') ||
    r.includes('unauthorized') ||
    r.includes('403') ||
    r.includes('401')
  ) {
    return 'The page blocked automated access.';
  }
  if (r.includes('robots')) return 'The page does not allow automated reading.';
  if (r.includes('captcha') || r.includes('challenge')) return 'The page asked for a human check.';
  return 'The page could not be read.';
}
