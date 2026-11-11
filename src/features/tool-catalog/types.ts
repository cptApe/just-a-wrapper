import type { z } from 'zod';
import type { MediaBilling } from '@/lib/media-billing';
import type { CustomToolName } from './declarations';
import type { ToolGate } from './gates';

// The custom-tool registry contract.
// Custom tools are executed by US (the API client), not the agent container:
// the agent calls one → Anthropic emits `agent.custom_tool_use` and parks the
// session at idle → our dispatcher runs the handler and posts a
// `user.custom_tool_result`. `riskLevel: 'destructive'` is OUR concept (Anthropic
// has no risk policy for custom tools) — destructive calls route through the
// persisted confirmation queue before the handler runs.

type RiskLevel = 'safe' | 'destructive';

// A JSON Schema object as Anthropic's `BetaManagedAgentsCustomToolInputSchema`
// expects it.
type ToolInputJsonSchema = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
};

// Pure metadata — no DB / no `server-only`, so the seed plan and the /dev page
// can import it. The handler + zod validation live in the server-only registry.
// Each declaration names its literal tool name so TOOL_DECLARATIONS derives the name union.
export type CustomToolDeclaration<Name extends string = CustomToolName> = {
  name: Name;
  description: string;
  riskLevel: RiskLevel;
  /** Park this tool for a one-call confirmation even when the user's policy is
   * unset or Allow. Used for Library and skill deletion;
   * the normal handler runs after approval. */
  alwaysAsk?: boolean;
  /** Declared to Anthropic at agent-seed time so the agent can call the tool. */
  inputJsonSchema: ToolInputJsonSchema;
  /** The capability that must be on before the tool is offered; absent means always on. */
  gate?: ToolGate;
};

/** What the agent is told about a tool; gates stay with the catalog. */
export type ToolRuntimeDeclaration = Omit<CustomToolDeclaration<string>, 'gate'>;

/** Resolved tenant context handed to a tool handler when it runs. */
export type ToolContext = {
  workspaceId: string;
  userId: string;
  /** The Anthropic session id the call originated from. */
  sessionId: string;
  /** OUR `session.id` row uuid; handlers that write rows referencing the
   *  session (generate_image's Library file) link it. */
  sessionRowId: string;
};

/** The caller's stored settings for a tool, as the permissions feature resolves them. */
export type StoredToolSettings = { defaultQuality?: 'low' | 'mid' | 'high' };

// A tool that spends vendor money declares its estimate, and the dispatcher passes it to the spend
// gate before the handler runs. A tool that measures a cost without an estimate does not compile.
type ToolCost<I, O> =
  | {
      estimateCredits?: undefined;
      measureVendorCostCents?: undefined;
      mediaBilling?: undefined;
    }
  | {
      /** Credits the call may cost, at most; the gate refuses when they are not on hand. */
      estimateCredits: (input: I, settings: StoredToolSettings) => number;
      measureVendorCostCents?: (input: I, output: O) => number;
      /** Cost is resolved only after the durable output has been delivered. */
      mediaBilling?: (output: O) => MediaBilling;
    };

// The full server-side tool: declaration + runtime validation + handler. `I`/`O`
// are inferred from the zod schemas so handlers are fully typed. The name stays a
// string so dispatch tests can bind stand-in tools; the registry keys real names.
export type CustomTool<I = unknown, O = unknown> = ToolRuntimeDeclaration & {
  inputSchema: z.ZodType<I & Record<string, unknown>>;
  outputSchema: z.ZodType<O>;
  handler: (input: I, ctx: ToolContext) => Promise<O>;
  /**
   * Billing source for measured cost: 'generation' tags the usage event
   * as media generation; absent means a plain vendor pass-through tool_call.
   */
  accrualSource?: 'generation';
} & ToolCost<I, O>;

export type DispatchContext = {
  /** Anthropic session id — what we post results back to. */
  anthropicSessionId: string;
  /** Local `session` row id — FK target for pending_confirmation. */
  sessionRowId: string;
  workspaceId: string;
  /** Tenant key for tool_permission rows (custom-tool gating). */
  organizationId: string;
  userId: string;
  actorUserId: string;
};

export type ToolCall = { toolUseId: string; name: string; input: unknown };

export type DispatchOutcome = { toolUseId: string; name: string } & (
  | { status: 'posted'; isError: boolean; detail?: string }
  | { status: 'pending' | 'retry'; detail?: string }
);

export type ParkedToolCall = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  workspaceId: string;
  requestedByUserId: string;
};
