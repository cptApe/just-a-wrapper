// Seed diffs compare only configured fields, ignoring server-generated metadata.
// Normalize model objects and effective tool policies before comparison.
// Hosts and coordinator rosters are sets; their order carries no behavior.
// Call update only for real changes so no-op runs preserve agent versions.

import type Anthropic from '@anthropic-ai/sdk';
import { AGENT_TOOLSET_TYPE } from '@/features/agents/types';
import { BUILTIN_TOOL_NAMES } from '@/features/tool-catalog/builtin-tools';
import type { AgentTool } from '../seed-plan';

export type FieldDiff = {
  field: string;
  /** The value the seed plan wants. */
  desired: unknown;
  /** The value currently live on the server (normalized to the desired shape). */
  live: unknown;
};

/** The agent fields the seed plan sets — the only ones we diff. */
export type DesiredAgent = {
  description: string;
  model: string;
  system: string;
  tools: AgentTool[];
  mcp_servers: unknown[];
  multiagent: Anthropic.Beta.BetaManagedAgentsMultiagentParams | null;
};

/**
 * The subset of a retrieved agent we compare against. `model` arrives as an
 * object (we send a string); `tools` arrive with extra resolved config we never
 * sent; compare toolset types and the custom definitions we configure.
 */
export type LiveAgent = {
  id: string;
  version: number;
  description: string | null;
  model: { id: string; speed?: string };
  system: string | null;
  tools: Anthropic.Beta.BetaManagedAgentsAgent['tools'];
  mcp_servers: unknown[];
  multiagent: Anthropic.Beta.BetaManagedAgentsMultiagent | null;
};

export function diffAgent(desired: DesiredAgent, live: LiveAgent): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  if (desired.description !== live.description) {
    diffs.push({ field: 'description', desired: desired.description, live: live.description });
  }

  // `model` is normalized server-side into { id, speed }; compare on id only,
  // since the plan never sets speed (server default "standard").
  if (desired.model !== live.model.id) {
    diffs.push({ field: 'model', desired: desired.model, live: live.model.id });
  }

  // `system` is `string | null` server-side; the plan always sets a string.
  if (desired.system !== live.system) {
    diffs.push({ field: 'system', desired: desired.system, live: live.system });
  }

  // Compare tools by their `type` list first — presence/order of toolsets.
  const desiredToolTypes = desired.tools.map((t) => t.type);
  const liveToolTypes = live.tools.map((t) => t.type);
  if (!arraysEqual(desiredToolTypes, liveToolTypes)) {
    diffs.push({ field: 'tools', desired: desiredToolTypes, live: liveToolTypes });
  }

  const desiredCustomTools = desired.tools
    .filter((tool) => tool.type === 'custom')
    .map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const liveCustomTools = live.tools
    .filter((tool) => tool.type === 'custom')
    .map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  if (!deepEqual(desiredCustomTools, liveCustomTools)) {
    diffs.push({ field: 'custom_tools', desired: desiredCustomTools, live: liveCustomTools });
  }

  // Compare effective built-in policies as well as tool types.
  // Resolve configs over default_config so policy-only changes trigger reseeding.
  // Compare only when both sides declare the agent toolset.
  const desiredPolicies = builtinPolicySummary(desired.tools.find(isAgentToolset));
  const livePolicies = builtinPolicySummary(live.tools.find(isAgentToolset));
  if (desiredPolicies && livePolicies && !deepEqual(desiredPolicies, livePolicies)) {
    diffs.push({ field: 'builtin_tool_policies', desired: desiredPolicies, live: livePolicies });
  }

  // The seed plan leaves mcp_servers empty.
  if (!deepEqual(desired.mcp_servers, live.mcp_servers)) {
    diffs.push({ field: 'mcp_servers', desired: desired.mcp_servers, live: live.mcp_servers });
  }

  const desiredMultiagent = normalizeDesiredMultiagent(desired.multiagent);
  const liveMultiagent = normalizeLiveMultiagent(live.multiagent, live.id, live.version);
  if (!deepEqual(desiredMultiagent, liveMultiagent)) {
    diffs.push({ field: 'multiagent', desired: desiredMultiagent, live: liveMultiagent });
  }

  return diffs;
}

type ComparableRosterEntry =
  | { type: 'self' }
  | { type: 'advisor'; model: string }
  | { type: 'agent'; id: string; version?: number };

type ComparableMultiagent = { type: 'coordinator'; agents: ComparableRosterEntry[] } | null;

function normalizeDesiredMultiagent(
  multiagent: Anthropic.Beta.BetaManagedAgentsMultiagentParams | null,
): ComparableMultiagent {
  if (!multiagent) return null;
  return {
    type: 'coordinator',
    agents: sortRosterEntries(
      multiagent.agents.map((entry) => {
        if (typeof entry === 'string') return { type: 'agent', id: entry };
        return entry;
      }),
    ),
  };
}

function normalizeLiveMultiagent(
  multiagent: Anthropic.Beta.BetaManagedAgentsMultiagent | null,
  ownerAgentId: string,
  ownerAgentVersion: number,
): ComparableMultiagent {
  if (!multiagent) return null;
  return {
    type: 'coordinator',
    agents: sortRosterEntries(
      multiagent.agents.map((entry) => {
        if (entry.type === 'advisor') return { type: 'advisor', model: entry.model };
        // A resolved self entry advances to the owner's latest version after
        // an update.
        if (entry.id === ownerAgentId && entry.version === ownerAgentVersion) {
          return { type: 'self' };
        }
        return { type: 'agent', id: entry.id, version: entry.version };
      }),
    ),
  };
}

function sortRosterEntries(entries: ComparableRosterEntry[]): ComparableRosterEntry[] {
  return [...entries].sort((left, right) =>
    rosterEntryKey(left).localeCompare(rosterEntryKey(right)),
  );
}

function rosterEntryKey(entry: ComparableRosterEntry): string {
  switch (entry.type) {
    case 'self':
      return 'self';
    case 'advisor':
      return `advisor:${entry.model}`;
    case 'agent':
      return `agent:${entry.id}:${entry.version ?? ''}`;
  }
}

function isAgentToolset(tool: { type: string }): boolean {
  return tool.type === AGENT_TOOLSET_TYPE;
}

function permissionPolicyType(policy: unknown): string | null {
  if (!isRecord(policy)) return null;
  return typeof policy.type === 'string' ? policy.type : null;
}

/**
 * Resolve an agent-toolset tool into an effective permission policy per built-in
 * tool name: `'disabled'` (enabled:false) | `'always_allow'` | `'always_ask'`,
 * applying per-tool `configs` over `default_config` (API default `always_allow`
 * when neither is set). Returns null when the tool is absent or not the agent
 * toolset. Normalizes both the sparse config we send and the resolved config the
 * API echoes back to the same shape, so only a real policy change diffs.
 */
function builtinPolicySummary(tool: unknown): Record<string, string> | null {
  if (!isRecord(tool) || tool.type !== AGENT_TOOLSET_TYPE) return null;
  const defaultPolicy = isRecord(tool.default_config)
    ? (permissionPolicyType(tool.default_config.permission_policy) ?? 'always_allow')
    : 'always_allow';
  const byName = new Map<string, Record<string, unknown>>();
  if (Array.isArray(tool.configs)) {
    for (const config of tool.configs) {
      if (isRecord(config) && typeof config.name === 'string') byName.set(config.name, config);
    }
  }
  const summary: Record<string, string> = {};
  for (const name of BUILTIN_TOOL_NAMES) {
    const config = byName.get(name);
    if (config && config.enabled === false) {
      summary[name] = 'disabled';
    } else {
      summary[name] = (config && permissionPolicyType(config.permission_policy)) ?? defaultPolicy;
    }
  }
  return summary;
}

/** The environment-config fields the seed plan sets — the only ones we diff. */
type DesiredNetworking =
  | { type: 'unrestricted' }
  | {
      type: 'limited';
      allowed_hosts: string[];
      allow_mcp_servers: boolean;
      allow_package_managers: boolean;
    };

export type DesiredEnvironmentConfig = {
  type: string;
  networking: DesiredNetworking;
};

/**
 * The subset of a retrieved environment config we compare against. The live
 * object also carries `packages`, plus the parent carries description/metadata/
 * scope/timestamps — all server-defaulted and excluded here.
 */
type LiveNetworking = {
  type: string;
  allowed_hosts?: string[];
  allow_mcp_servers?: boolean;
  allow_package_managers?: boolean;
};

export type LiveEnvironmentConfig = {
  type: string;
  networking: LiveNetworking;
};

export function diffEnvironment(
  desired: DesiredEnvironmentConfig,
  live: LiveEnvironmentConfig,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  if (desired.type !== live.type) {
    diffs.push({ field: 'config.type', desired: desired.type, live: live.type });
  }

  const dn = desired.networking;
  const ln = live.networking;

  if (dn.type !== ln.type) {
    diffs.push({ field: 'networking.type', desired: dn.type, live: ln.type });
  }

  // The allow-list and per-mode flags only exist (and only matter) when both
  // sides are `limited`. If the modes already differ, that single diff is enough
  // to trigger reconciliation — comparing sub-fields across modes is noise.
  if (dn.type === 'limited' && ln.type === 'limited') {
    if (!setsEqual(dn.allowed_hosts, ln.allowed_hosts ?? [])) {
      diffs.push({
        field: 'networking.allowed_hosts',
        desired: dn.allowed_hosts,
        live: ln.allowed_hosts ?? [],
      });
    }
    if (dn.allow_mcp_servers !== ln.allow_mcp_servers) {
      diffs.push({
        field: 'networking.allow_mcp_servers',
        desired: dn.allow_mcp_servers,
        live: ln.allow_mcp_servers,
      });
    }
    if (dn.allow_package_managers !== ln.allow_package_managers) {
      diffs.push({
        field: 'networking.allow_package_managers',
        desired: dn.allow_package_managers,
        live: ln.allow_package_managers,
      });
    }
  }

  return diffs;
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
}

/** Order-independent equality for a list of strings (e.g. allowed_hosts). */
function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((v) => set.has(v));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural deep equality (arrays + plain objects + primitives). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return arraysEqual(a, b);
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    return arraysEqual(aKeys, bKeys) && aKeys.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}
