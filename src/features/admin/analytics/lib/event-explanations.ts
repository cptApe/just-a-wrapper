import type { AnalyticsEventName } from '@/lib/analytics-events';

// Keyed by the registry, so a new event without an explanation is a compile error.

export const EVENT_AREAS = [
  'Signup',
  'Tasks and turns',
  'Tools',
  'Billing',
  'Files and sharing',
  'Skills and memory',
  'Connections',
] as const;

export type EventArea = (typeof EVENT_AREAS)[number];

export type EventExplanation = { area: EventArea; fires: string; tells: string };

export const EVENT_EXPLANATIONS: Record<AnalyticsEventName, EventExplanation> = {
  'account:signup_click': {
    area: 'Signup',
    fires: 'A visitor presses a Get started button on the landing page',
    tells: 'How many visitors want to sign up, and from which part of the page',
  },
  'account:signup_complete': {
    area: 'Signup',
    fires: 'A new account is created, once per person',
    tells: 'How many people sign up each day',
  },
  'workspace:create': {
    area: 'Signup',
    fires: 'A workspace is created, including the personal one every account gets',
    tells: 'How many workspaces exist and when they were made',
  },
  'team:invite_send': {
    area: 'Signup',
    fires: 'Someone invites a teammate to a workspace',
    tells: 'Which workspaces are growing into teams',
  },
  'team:invite_accept': {
    area: 'Signup',
    fires: 'An invited teammate joins the workspace',
    tells: 'How many invites turn into members',
  },
  'session:create': {
    area: 'Tasks and turns',
    fires: 'A chat or a scheduled task run starts',
    tells: 'How much the product is used, by kind and by plan',
  },
  'session:message_send': {
    area: 'Tasks and turns',
    fires: 'A person sends a message into a task (never the app talking to itself)',
    tells: 'Daily active people and how deep conversations go',
  },
  'session:turn_complete': {
    area: 'Tasks and turns',
    fires: 'The agent finishes answering one message',
    tells: 'How fast the first words arrive, how long a turn takes, and how many turns end badly',
  },
  'task:schedule': {
    area: 'Tasks and turns',
    fires: 'A person sets up a scheduled or event-driven task',
    tells: 'Who is automating work, not just chatting',
  },
  'tool:call_complete': {
    area: 'Tools',
    fires: 'A custom tool finishes and its result reaches the agent',
    tells: 'Which tools get used, how long they take, and what they cost in credits',
  },
  'tool:call_fail': {
    area: 'Tools',
    fires: 'A custom tool fails or is blocked by permissions',
    tells: 'Which tools break and why',
  },
  'tool:connect': {
    area: 'Connections',
    fires: 'A connected app (Gmail, Notion and so on) is seen connected for the first time',
    tells: 'Which apps people connect',
  },
  'billing:topup_purchase': {
    area: 'Billing',
    fires: 'A credit top-up is paid, once per payment',
    tells: 'Revenue from top-ups and who buys',
  },
  'billing:plan_cancel': {
    area: 'Billing',
    fires: 'A paid plan ends',
    tells: 'How many paid plans end, and when',
  },
  'billing:credit_spend': {
    area: 'Billing',
    fires: 'A turn finishes and its credits are added up, plus each voice dictation',
    tells: 'Where credits go: model, tools, runtime, voice',
  },
  'file:upload': {
    area: 'Files and sharing',
    fires: 'A file lands in the Library or a chat',
    tells: 'How much people bring their own material',
  },
  'artifact:save': {
    area: 'Files and sharing',
    fires: 'A person saves something the agent made into the Library',
    tells: 'Whether the agent produces things worth keeping',
  },
  'share:create': {
    area: 'Files and sharing',
    fires: 'A task, folder, or link is shared',
    tells: 'How much sharing happens, and of what',
  },
  'skill:install': {
    area: 'Skills and memory',
    fires: 'A custom skill is created, by a person or by the agent',
    tells: 'Who builds their own skills',
  },
  'memory:note_create': {
    area: 'Skills and memory',
    fires: 'A memory note is created from the Memory page',
    tells: 'Who curates what the agent remembers',
  },
};
