import type Anthropic from '@anthropic-ai/sdk';
import {
  buildSessionGroundingBlock,
  composeDeploymentSystemText,
  composeSessionStartUserText,
  formatCurrentTimeLine,
} from '@/features/sessions/lib/session-context';
import {
  buildTitleUserText,
  TITLE_MODEL,
  TITLE_SYSTEM,
} from '@/features/sessions/lib/title-prompt';
import { buildDeploymentInitialEvents } from '@/features/tasks/lib/build-deployment-initial-events';

// Every piece of text this product puts in front of a model, in one list.
//
// The admin Prompts page renders this registry, so an admin can see the whole
// inventory without reading the codebase: what the text is, where it lives, which
// model reads it, and when it is sent. Entries pull from the LIVE constants and
// builders — nothing here is a pasted copy, so edits at the source show up here.
//
// This module is deliberately PURE: no server-only imports, no IO, no DB. The
// `node --test` unit runner imports it directly, and rendering it must never
// depend on request context. Builders are rendered with the fixed sample values
// below (including a fixed clock) so the page's output is deterministic — a bare
// `new Date()` here would produce a hydration mismatch and an untestable page.

type DeploymentInitialEvent = Anthropic.Beta.BetaManagedAgentsDeploymentInitialEventParams;

export type PromptRegistryEntry = {
  id: string;
  /** Plain-language name, the way an admin would say it. */
  name: string;
  /** Repo-relative path to the source of truth for this text. */
  file: string;
  /** The model that reads it, or null when the plan the user is on decides. */
  model: string | null;
  /** One plain sentence: when this text is sent. */
  fires: string;
  /**
   * The text itself, rendered with the sample values below where it is a
   * builder. Empty for the system prompt, which the page renders whole.
   */
  text: string;
  kind: 'system' | 'scripted' | 'builder';
  /** Where the entry sits on the Prompts page: the system prompt renders whole, the rest as cards. */
  group: PromptGroup;
};

type PromptGroup = 'system-prompt' | 'session-grounding' | 'session-title' | 'scheduled-runs';

// Fixed sample values for every builder in the registry. One person, one
// business, one clock, so two entries rendered side by side tell a coherent
// story. The instant below is 4:12 pm in Europe/Vilnius (UTC+3 in August); it is
// written in UTC on purpose, since a bare local-time literal would render
// differently depending on the machine's timezone.
const SAMPLE = {
  displayName: 'Sam',
  workspaceName: 'Acme Studio',
  timeZone: 'Europe/Vilnius',
  now: new Date('2026-08-20T13:12:00Z'),
  taskDescription: 'Every Monday at 8am, list the quotes with no reply for 7 days.',
} as const;

// The page renders the composed prompt directly, so this entry carries no text.
const SYSTEM_PROMPT_ENTRY: PromptRegistryEntry = {
  id: 'system-prompt',
  name: 'System prompt',
  file: 'src/features/agent-setup/system-prompts.ts',
  model: null,
  fires: 'Seeded onto every agent, and read on every turn of every task.',
  text: '',
  kind: 'system',
  group: 'system-prompt',
};

// A deployment is set up with an ORDERED LIST of typed events, not one string,
// so the rendering names each event and then prints its text verbatim. Raw
// JSON is unreadable here: the prompt text is a JSON string value, so every
// newline in it shows up as a literal \n and the whole grounding block
// collapses into one unbroken line.
function renderEventText(event: DeploymentInitialEvent): string {
  if (event.type === 'user.define_outcome') {
    const rubric = event.rubric.type === 'text' ? event.rubric.content : '';
    return [event.description, rubric && `Success criteria: ${rubric}`]
      .filter(Boolean)
      .join('\n\n');
  }
  return event.content
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('\n');
}

function renderDeploymentEvents(mode: 'event' | 'inline'): string {
  const events = buildDeploymentInitialEvents({
    description: SAMPLE.taskDescription,
    systemText: composeDeploymentSystemText({
      timeZone: SAMPLE.timeZone,
      displayName: SAMPLE.displayName,
      workspaceName: SAMPLE.workspaceName,
    }),
    systemTextMode: mode,
    successCriteria: null,
  });
  return events
    .map((event, index) => `[${index + 1}] ${event.type}\n\n${renderEventText(event)}`)
    .join('\n\n────────\n\n');
}

export const PROMPT_REGISTRY: readonly PromptRegistryEntry[] = [
  SYSTEM_PROMPT_ENTRY,
  {
    id: 'session-grounding-block',
    name: 'Session grounding block',
    file: 'src/features/sessions/lib/session-context.ts',
    model: null,
    fires:
      'Once, at the top of the first message of every task. It carries the slow-changing facts (who the user is, their workspace, their timezone, where memory is mounted) and deliberately no date, because a task can be reopened days later and a baked-in date would become a lie we cannot edit out.',
    text: buildSessionGroundingBlock({
      displayName: SAMPLE.displayName,
      workspaceName: SAMPLE.workspaceName,
      timeZone: SAMPLE.timeZone,
    }),
    kind: 'builder',
    group: 'session-grounding',
  },
  {
    id: 'current-time-line',
    name: 'Current time line',
    file: 'src/features/sessions/lib/session-context.ts',
    model: null,
    fires:
      'At the end of every single message the user sends. It is the fast clock: appending it never invalidates the cached prompt above it, so the newest line always wins and the agent knows what day it is without us rewriting history.',
    text: formatCurrentTimeLine(SAMPLE.now, SAMPLE.timeZone),
    kind: 'builder',
    group: 'session-grounding',
  },
  {
    id: 'session-start-user-text',
    name: 'Opening message wrapper',
    file: 'src/features/sessions/lib/session-context.ts',
    model: null,
    fires:
      'On the first message of a task, wrapping what the user actually typed. The grounding block goes in front and the time line goes behind, both fenced in tags the app strips everywhere user text is shown, so the model reads them and the user never sees them.',
    text: composeSessionStartUserText({
      now: SAMPLE.now,
      timeZone: SAMPLE.timeZone,
      userText: 'Which quotes have gone quiet this month?',
      displayName: SAMPLE.displayName,
      workspaceName: SAMPLE.workspaceName,
    }),
    kind: 'builder',
    group: 'session-grounding',
  },
  {
    id: 'session-title-system',
    name: 'Title writer',
    file: 'src/features/sessions/lib/title-prompt.ts',
    model: TITLE_MODEL,
    fires:
      'In the background, seconds after a task starts, to replace the placeholder title in the sidebar. A failure here is invisible: the truncated opening message stays as the title.',
    text: TITLE_SYSTEM,
    kind: 'system',
    group: 'session-title',
  },
  {
    id: 'session-title-message',
    name: 'Title input',
    file: 'src/features/sessions/lib/title-prompt.ts',
    model: TITLE_MODEL,
    fires:
      'Alongside the prompt above, carrying the opening message. It is fenced as data so a message that says “ignore all previous instructions” gets titled instead of obeyed.',
    text: buildTitleUserText('Which quotes have gone quiet this month?'),
    kind: 'builder',
    group: 'session-title',
  },
  {
    id: 'deployment-events-event',
    name: 'Scheduled run setup (Balanced and Expert)',
    file: 'src/features/tasks/lib/build-deployment-initial-events.ts',
    model: null,
    fires:
      'Once, when a scheduled task is created or edited, and replayed at the start of every run. Grounding rides its own system event on tiers whose model accepts one. Note the missing clock: creation time says nothing about run time, so the agent reads the container clock instead.',
    text: renderDeploymentEvents('event'),
    kind: 'builder',
    group: 'scheduled-runs',
  },
  {
    id: 'deployment-events-inline',
    name: 'Scheduled run setup (Fast)',
    file: 'src/features/tasks/lib/build-deployment-initial-events.ts',
    model: null,
    fires:
      'The same payload for the Fast tier, whose model rejects a separate system event. The grounding is folded into the opening message inside a fence the app strips before anyone reads it.',
    text: renderDeploymentEvents('inline'),
    kind: 'builder',
    group: 'scheduled-runs',
  },
];
