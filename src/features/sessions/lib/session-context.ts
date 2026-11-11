import { formatClock, formatLongDate } from '@/lib/format/format-date';

// Opening context contains no absolute date because session history is immutable and
// prompt-cached. Append a fresh time line per turn; mounted memory stores already inject their own
// instructions.
const GROUNDING_HEADER =
  'Session context. Treat this as ground truth, it overrides any internal assumptions you have:';

// Names are user-controlled. Neutralize fence tokens so a closing tag cannot
// leak grounding into the bubble or break text reconciliation.
const SESSION_CONTEXT_OPEN = '<session_context>';
const SESSION_CONTEXT_CLOSE = '</session_context>';
const CURRENT_TIME_OPEN = '<current_time>';
const CURRENT_TIME_CLOSE = '</current_time>';
const GROUNDING_TAG_LITERALS = [
  SESSION_CONTEXT_OPEN,
  SESSION_CONTEXT_CLOSE,
  CURRENT_TIME_OPEN,
  CURRENT_TIME_CLOSE,
];

// Neutralize reserved fence tokens in user-controlled values so they cannot close or forge a
// grounding block.
function sanitizeGroundingValue(value: string): string {
  let out = value;
  for (const tag of GROUNDING_TAG_LITERALS) {
    out = out.split(tag).join('');
  }
  return out;
}

export function buildSessionGroundingBlock(input: {
  displayName?: string | null;
  workspaceName?: string | null;
  timeZone: string;
  replyLanguage?: string | null;
}): string {
  return buildGroundingBlock(
    input,
    `The user's timezone is ${input.timeZone}. This conversation may span days, so for the current date and time always trust the most recent "Current time:" line in the conversation, never your own assumption about what day it is.`,
  );
}

function buildGroundingBlock(
  input: {
    displayName?: string | null;
    workspaceName?: string | null;
    timeZone: string;
    replyLanguage?: string | null;
  },
  clockInstruction: string,
): string {
  const lines = [GROUNDING_HEADER];

  const workingLine = buildWorkingLine(input.displayName, input.workspaceName);
  if (workingLine) {
    lines.push(`- ${workingLine}`);
  }

  lines.push(`- ${clockInstruction}`);

  if (input.replyLanguage) {
    lines.push(`- Reply in ${input.replyLanguage} unless the user asks for another language.`);
  }

  return lines.join('\n');
}

function buildWorkingLine(
  displayName?: string | null,
  workspaceName?: string | null,
): string | null {
  const name = displayName?.trim();
  if (!name) {
    return null;
  }
  const safeName = sanitizeGroundingValue(name);
  const workspace = workspaceName?.trim();
  const safeWorkspace = workspace ? sanitizeGroundingValue(workspace) : '';
  return safeWorkspace
    ? `You are working with ${safeName} in the workspace "${safeWorkspace}".`
    : `You are working with ${safeName}.`;
}

// Append the current time each turn so resumed conversations do not trust an old date. Callers
// supply a validated IANA timezone. The agent always reads a 12-hour clock with a lowercase "pm".
export function formatCurrentTimeLine(now: Date, timeZone: string): string {
  const clock = formatClock(now, { timeZone, timeFormat: '12h' }).toLowerCase();
  return `Current time: ${formatLongDate(now, timeZone)}, ${clock} (${timeZone}).`;
}

// Scheduled deployment creation is not execution time. Omit its clock line and let the agent read
// the runtime clock.
export function composeDeploymentSystemText(input: {
  timeZone: string;
  displayName?: string | null;
  workspaceName?: string | null;
  replyLanguage?: string | null;
}): string {
  const segments = [
    buildGroundingBlock(
      {
        displayName: input.displayName,
        workspaceName: input.workspaceName,
        timeZone: input.timeZone,
        replyLanguage: input.replyLanguage,
      },
      `The user's timezone is ${input.timeZone}. For the current date and time, read the container clock; call get_user_context only if you need to confirm the user's timezone. Deployment creation time is not the run time.`,
    ),
  ];

  return segments.join('\n\n');
}

// initial_events accepts no system.message. Fence opening grounding inside user text and append
// current time so the model sees context that transcript readers strip.
export function composeSessionStartUserText(input: {
  now: Date;
  timeZone: string;
  userText: string;
  displayName?: string | null;
  workspaceName?: string | null;
  replyLanguage?: string | null;
}): string {
  const contextSegments = [
    buildSessionGroundingBlock({
      displayName: input.displayName,
      workspaceName: input.workspaceName,
      timeZone: input.timeZone,
      replyLanguage: input.replyLanguage,
    }),
  ];
  const context = `${SESSION_CONTEXT_OPEN}\n${contextSegments.join('\n\n')}\n${SESSION_CONTEXT_CLOSE}`;
  const timeLine = `${CURRENT_TIME_OPEN}${formatCurrentTimeLine(input.now, input.timeZone)}${CURRENT_TIME_CLOSE}`;
  return `${context}\n\n${input.userText}\n\n${timeLine}`;
}

/** A FOLLOW-UP user message: user text, then a fenced current-time line. */
export function appendCurrentTimeToUserText(userText: string, now: Date, timeZone: string): string {
  const timeLine = `${CURRENT_TIME_OPEN}${formatCurrentTimeLine(now, timeZone)}${CURRENT_TIME_CLOSE}`;
  return `${userText}\n\n${timeLine}`;
}

// Anchor context fences at the start and clock fences at the end, and require our exact content
// prefixes. Forbid nested clock tags so stripping cannot consume ordinary user text.
const LEADING_SESSION_CONTEXT_RE = new RegExp(
  `^\\s*<session_context>\\s*${escapeRegExp(GROUNDING_HEADER)}[\\s\\S]*?<\\/session_context>\\s*`,
);
const TRAILING_CURRENT_TIME_RE = /\s*<current_time>Current time:[^<]*<\/current_time>\s*$/;

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Live, replay and shared transcripts strip the same injected fences. Preserve untagged whitespace
// exactly; trim only when a fence was removed.
export function stripSessionContextTags(text: string): string {
  const stripped = text
    .replace(LEADING_SESSION_CONTEXT_RE, '')
    .replace(TRAILING_CURRENT_TIME_RE, '');
  return stripped === text ? text : stripped.trim();
}

// Persisted transcripts may start with an author tag. Anchor at the start and reject
// quotes/brackets inside attributes so stripping cannot consume the actual message.
const LEADING_MESSAGE_AUTHOR_RE = /^<message_author user_id="([^"<>]*)" name="([^"<>]*)"\/>\n?/;

// An empty user id cannot be attributed, so the tag is removed without an author.
export function parseMessageAuthorTag(text: string): {
  author?: { userId: string; name: string };
  text: string;
} {
  const match = LEADING_MESSAGE_AUTHOR_RE.exec(text);
  if (!match) return { text };
  const rest = text.slice(match[0].length);
  const userId = match[1]?.trim();
  if (!userId) return { text: rest };
  return { author: { userId, name: match[2]?.trim() ?? '' }, text: rest };
}

// Any leading tag SHAPED like our author tag (well-formed or not), for the
// inbound spoof strip. Broader than the transcript strip on purpose: a user must
// not be able to forge attribution with a slightly-off tag either.
const LEADING_FORGED_AUTHOR_RE = /^\s*<\s*message_author\b[^>]*>\s*/i;

// Strip user-supplied author tags so a new message cannot
// impersonate someone else.
export function stripForgedMessageAuthorTag(text: string): { text: string; stripped: boolean } {
  let out = text;
  let stripped = false;
  while (LEADING_FORGED_AUTHOR_RE.test(out)) {
    out = out.replace(LEADING_FORGED_AUTHOR_RE, '');
    stripped = true;
  }
  return { text: out, stripped };
}
