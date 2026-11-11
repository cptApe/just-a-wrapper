// The product-analytics event registry — the single source of truth for every
// named business event we send to PostHog. A capture call can only reference a
// registered event (compile error otherwise), so there are no inline event
// strings anywhere. This is the taxonomy the standard describes; the standard is
// docs/spec/10-analytics-events.md (read it before adding an event).
//
// Pure + dependency-free on purpose (types + const literals only): unit tests
// can import it under the type-stripping `node --test` runner without a
// bundler, env, or SDK. Errors/logs are a DIFFERENT pipeline (04-observability);
// the dot.case notification event names in features/notifications/lib/events.ts are a
// different vocabulary — do not mix them here.
//
// Naming (PostHog's `category:object_action` framework): lowercase
// snake_case, present-tense, `<category>:<object>_<action>` — with the object
// omitted when it is the category itself (`workspace:create`). The pre-colon
// `category` is an EventCategory; the final `_`-token is an EventVerb.
// Never interpolate values into a name (`skill:install` plus a `skill_slug`
// property). `side` declares the single owner
// runtime — server wins wherever a server path exists, so an event is
// never double-counted. `conversion: true` marks a revenue moment.
// The type check enforces the category and verb grammar against the two unions below.

// Category whitelist: product domains, singular. The pre-colon segment
// of every event name must be one of these. Adding a category is a PR to this
// list + the registry, never a judgment call at a call site.
type EventCategory =
  | 'account'
  | 'workspace'
  | 'team'
  | 'session'
  | 'task'
  | 'file'
  | 'artifact'
  | 'memory'
  | 'skill'
  | 'tool'
  | 'billing'
  | 'share';

// Verb whitelist: PostHog's recommended base plus our curated additions,
// present tense. The final `_`-token of every event name must be one of these.
type EventVerb =
  | 'click'
  | 'submit'
  | 'create'
  | 'view'
  | 'add'
  | 'invite'
  | 'update'
  | 'delete'
  | 'remove'
  | 'start'
  | 'end'
  | 'cancel'
  | 'fail'
  | 'generate'
  | 'send'
  | 'complete'
  | 'connect'
  | 'install'
  | 'upload'
  | 'schedule'
  | 'save'
  | 'purchase'
  | 'accept'
  | 'spend';

export type AnalyticsEventDef = {
  // The sentence an agent reads to know exactly WHEN this fires; also the text
  // mirrored into PostHog Data Management. State the durable moment.
  description: string;
  side: 'server' | 'client';
  conversion?: true;
};

// The starting catalog. Grow deliberately: an event earns its place only
// if it answers a question about activation, retention, revenue, or a funnel we
// act on. Every entry here resolves to `server` — each becomes true on our server
// (auth hook, feature api/, or webhook), so per the server-wins rule that is
// where it fires. The client helper (analytics-client.ts) exists for the
// pure-intent exceptions added later.
export const ANALYTICS_EVENTS = {
  // Activation
  'account:signup_click': {
    description:
      'Landing page call to action clicked, before the sign-in page loads. Fires from the landing page (client) with cta_position: hero, pricing or footer.',
    side: 'client',
  },
  'account:signup_complete': {
    description:
      'A new user account was provisioned — fires from the Better Auth signup hook, once per user.',
    side: 'server',
  },
  'workspace:create': {
    description:
      'A workspace (Better Auth organization) was created — fires in the workspace-create feature api after the org row is committed.',
    side: 'server',
  },
  'session:create': {
    description:
      'A user started an agent session (chat or task) — fires in the session-create feature api after the session row is committed.',
    side: 'server',
  },
  'session:message_send': {
    description:
      'A user sent a message into an agent session — fires server-side after the message is persisted to the session.',
    side: 'server',
  },
  'tool:connect': {
    description:
      'A user connected a tool integration — fires on the first status read that shows the toolkit connected after the user returns from OAuth (Composio holds the callback); carries toolkit_slug.',
    side: 'server',
  },
  'skill:install': {
    description:
      'A custom skill was created in a workspace, by the user in Tools or by the agent saving one — fires after the skill row points at the pushed Anthropic skill; carries skill_id and skill_kind (never a name).',
    side: 'server',
  },
  'file:upload': {
    description: 'A user uploaded a file — fires after the file is registered with the workspace.',
    side: 'server',
  },
  'session:turn_complete': {
    description:
      'An agent turn finished streaming — fires server-side when the turn ends; carries ttft_ms (time from the user message to the first assistant token), duration_ms, tier and is_error.',
    side: 'server',
  },
  'tool:call_complete': {
    description:
      'A custom tool call finished successfully — fires server-side after the tool result is returned to the agent; carries tool_name and duration_ms.',
    side: 'server',
  },
  'tool:call_fail': {
    description:
      'A custom tool call failed or was blocked — fires server-side after the failure is returned to the agent; carries tool_name, duration_ms and failure_kind.',
    side: 'server',
  },
  // Depth / retention
  'task:schedule': {
    description:
      'A user scheduled a task to run (one-off or recurring) — fires after the schedule is persisted.',
    side: 'server',
  },
  'artifact:save': {
    description:
      'A user saved a session artifact to their library — fires after the artifact row is committed.',
    side: 'server',
  },
  'share:create': {
    description:
      'A user created a share link or shared an item with their team — fires after the share is committed.',
    side: 'server',
  },
  'team:invite_send': {
    description:
      'A user sent a workspace invite to a teammate — fires after the invite is created and the email is enqueued.',
    side: 'server',
  },
  'team:invite_accept': {
    description:
      'An invited teammate accepted a workspace invite and joined — fires after the membership row is committed.',
    side: 'server',
  },
  'memory:note_create': {
    description:
      'A note was written to the memory store (by the user or an agent on their behalf) — fires after the note row is committed.',
    side: 'server',
  },
  // Revenue — all server, all fired from webhooks / auth hooks
  'billing:topup_purchase': {
    description:
      'A credit top-up was paid — fires in the Stripe webhook after the grant is committed, behind the idempotency guard.',
    side: 'server',
    conversion: true,
  },
  'billing:plan_cancel': {
    description:
      'A user cancelled their paid plan — fires in the Stripe/Churnkey webhook after the cancellation is recorded.',
    side: 'server',
    conversion: true,
  },
  'billing:credit_spend': {
    description:
      'Credits were charged for agent usage — fires once per completed agent turn (from the relay, fenced on the terminal event id) with credits (the turn total), a breakdown (credits_model, credits_tools, credits_runtime, credits_voice), usage_kind turn and tier; voice dictation outside a session fires its own with usage_kind voice_transcription and tier null.',
    side: 'server',
  },
} as const satisfies Record<string, AnalyticsEventDef>;

type EventGrammar = `${EventCategory}:${EventVerb}` | `${EventCategory}:${string}_${EventVerb}`;
// A registry key outside the grammar fails the type check on this line.
type GrammarChecked<Name extends EventGrammar> = Name;

export type AnalyticsEventName = GrammarChecked<keyof typeof ANALYTICS_EVENTS>;

function eventNames<T extends Record<string, AnalyticsEventDef>>(events: T) {
  const names: (keyof T)[] = [];
  for (const name in events) names.push(name);
  return names;
}
export const ANALYTICS_EVENT_NAMES = eventNames(ANALYTICS_EVENTS);
