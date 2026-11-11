// Shared types for the per-tool permission model.

import type { ToolSettings } from './lib/tool-settings';

/** What a tool_permission row says about one integration action. */
export type ToolPolicy = 'allow' | 'ask' | 'block';

/** Internal run approval mode — interactive tasks ask; scheduled runs may skip. */
export type PermissionMode = 'ask' | 'auto';

/**
 * What the relay does with an Anthropic-side ask-gate after policy resolution:
 * confirm it (`allow`), deny it because an action is blocked (`deny`), deny an
 * unreadable call in an unattended session (`refuse`), or leave it for a person (`gate`).
 */
export type GateOutcome = 'allow' | 'deny' | 'refuse' | 'gate';

/** One toolkit's persisted policy state, as the permission UIs read it. */
export type ToolkitPermissions = {
  /** Explicit per-tool rows, keyed by the upstream tool name. */
  tools: Record<string, ToolPolicy>;
  /**
   * Non-policy per-tool settings: the chosen default generation quality
   * for a tool, keyed by tool name. Only tools the user has configured appear;
   * an absent entry means "use the product default".
   */
  settings: Partial<Record<string, ToolSettings>>;
};

/** What a policy row addresses: always one exact tool. */
export type PolicyTarget = { kind: 'tool'; toolName: string };

export type ToolPermissionChange = { target: PolicyTarget; policy: ToolPolicy | null };
