// Pure seed plan: no API key is needed for dry runs or tests.
import type Anthropic from '@anthropic-ai/sdk';
import { AGENT_TIER_LIST, agentName, environmentName } from '@/features/agents/config';
import { AGENT_TOOLSET_TYPE, type AgentTier } from '@/features/agents/types';
import {
  type CustomToolPlan,
  customToolDeclarations,
  isGatedToolOn,
} from '@/features/tool-catalog/declarations';
import { type Capabilities, resolveCapabilitiesFromEnv } from '@/lib/capabilities';
import { composeSystemPrompt } from './system-prompts';

type EnvironmentPlan = {
  name: string;
  config: {
    type: 'cloud';
    networking:
      | { type: 'unrestricted' }
      | {
          type: 'limited';
          allowed_hosts: string[];
          allow_mcp_servers: boolean;
          allow_package_managers: boolean;
        };
  };
};

// Every mcp_servers entry needs an mcp_toolset reference or the API rejects it.
const MCP_SERVER_NAME = 'composio';

// SDK types keep the plan key-free; configs override default_config for individual tools.
type ToolsetToolConfig = Anthropic.Beta.BetaManagedAgentsAgentToolConfigParams;
type ToolsetDefaultConfig = Anthropic.Beta.BetaManagedAgentsAgentToolsetDefaultConfigParams;
type ToolsetPlan = {
  type: typeof AGENT_TOOLSET_TYPE;
  default_config: ToolsetDefaultConfig;
  configs: ToolsetToolConfig[];
};

export type AgentTool = ToolsetPlan | McpToolsetPlan | CustomToolPlan;
type McpToolsetPlan = { type: 'mcp_toolset'; mcp_server_name: typeof MCP_SERVER_NAME };

// The session sandbox bounds built-ins; Library deletion has its own confirmation gate.
const ALWAYS_ALLOW: ToolsetDefaultConfig['permission_policy'] = { type: 'always_allow' };
type McpServerPlan = { type: 'url'; name: typeof MCP_SERVER_NAME; url: string };

type AgentPlan = {
  slug: AgentTier;
  name: string;
  description: string;
  model: string;
  system: string;
  // Pre-built agent toolset, plus the mcp_toolset once MCP_PROXY_URL is known.
  tools: AgentTool[];
  // Empty until the proxy URL exists; then exactly one entry — our proxy.
  mcp_servers: McpServerPlan[];
  // Each tier can delegate to a copy of itself.
  multiagent: Anthropic.Beta.BetaManagedAgentsMultiagentParams;
};

export type SeedPlan = {
  deployEnv: string;
  /** The hosts the Environment's egress allow-list opens, derived from inputs. */
  environment: EnvironmentPlan;
  agents: AgentPlan[];
  /** Non-fatal notes printed by the seed script (e.g. proxy URL not set yet). */
  warnings: string[];
};

export type SeedPlanInput = {
  capabilities: Capabilities;
  /** VERCEL_ENV (or a local override). Scopes agent/env names per environment. */
  deployEnv: string;
  /** Composio MCP-proxy URL; omit it when the proxy is not configured. */
  mcpProxyUrl?: string;
  /** Extra hosts the agent must reach (beyond the proxy). */
  extraAllowedHosts?: string[];
};

// Least privilege: only Anthropic until the configured proxy host is added.
const BASE_ALLOWED_HOSTS = ['api.anthropic.com'];

function hostFromUrl(url: string): string | null {
  // Validate without throwing: a malformed proxy URL must record a warning, not
  // crash the dry run. URL.canParse avoids a try/catch (and the no-silent-catch
  // rule) while keeping the non-fatal behavior the plan needs.
  if (!URL.canParse(url)) {
    return null;
  }
  return new URL(url).host;
}

export function buildSeedPlan(input: SeedPlanInput): SeedPlan {
  const warnings: string[] = [];
  const allowedHosts = [...BASE_ALLOWED_HOSTS, ...(input.extraAllowedHosts ?? [])];

  let proxyUrl: string | null = null;
  if (input.mcpProxyUrl) {
    const host = hostFromUrl(input.mcpProxyUrl);
    if (host) {
      allowedHosts.push(host);
      proxyUrl = input.mcpProxyUrl;
    } else {
      warnings.push(
        `MCP_PROXY_URL is not a valid URL ("${input.mcpProxyUrl}") — proxy host omitted from the egress allow-list.`,
      );
    }
  } else {
    warnings.push(
      'MCP_PROXY_URL is not set — seeding the environment WITHOUT the proxy host and the agents WITHOUT mcp_servers. Re-run once the proxy is deployed.',
    );
  }

  const environment: EnvironmentPlan = {
    name: environmentName(input.deployEnv),
    config: {
      type: 'cloud',
      networking: environmentNetworking(input.capabilities, allowedHosts),
    },
  };

  // Configured proxy URLs require both mcp_servers and mcp_toolset declarations.
  // Declare custom tools too so agent.custom_tool_use reaches the dispatcher.
  const mcpTools: McpToolsetPlan[] = proxyUrl
    ? [{ type: 'mcp_toolset', mcp_server_name: MCP_SERVER_NAME }]
    : [];
  const tools: AgentTool[] = [
    {
      type: AGENT_TOOLSET_TYPE,
      default_config: { permission_policy: ALWAYS_ALLOW },
      configs: (['web_search', 'web_fetch'] as const).map((name) => ({
        name,
        enabled: isGatedToolOn(name, input.capabilities),
      })),
    },
    ...mcpTools,
    ...customToolDeclarations(input.capabilities),
  ];
  const mcpServers: McpServerPlan[] = proxyUrl
    ? [{ type: 'url', name: MCP_SERVER_NAME, url: proxyUrl }]
    : [];

  const agents: AgentPlan[] = AGENT_TIER_LIST.map((tier) => ({
    slug: tier.tier,
    name: agentName(tier.tier, input.deployEnv),
    description: 'A copy of this agent for work it hands off.',
    model: tier.model,
    system: composeSystemPrompt(input.capabilities),
    tools,
    mcp_servers: mcpServers,
    multiagent: selfCoordinator(),
  }));

  return { deployEnv: input.deployEnv, environment, agents, warnings };
}

function selfCoordinator(): Anthropic.Beta.BetaManagedAgentsMultiagentParams {
  return { type: 'coordinator', agents: [{ type: 'self' }] };
}

// Native web tools and sandbox browsing must reach hosts not known at seed time.
// Limited egress is fixed on creation; allow_mcp_servers admits configured MCP servers.
function environmentNetworking(
  capabilities: Capabilities,
  allowedHosts: string[],
): EnvironmentPlan['config']['networking'] {
  if (!isGatedToolOn('browse_open', capabilities) || isGatedToolOn('web_search', capabilities)) {
    return { type: 'unrestricted' };
  }
  return {
    type: 'limited',
    allowed_hosts: [...new Set(allowedHosts)],
    allow_mcp_servers: true,
    // Least privilege: packages are preinstalled; see docs/spec/03-patterns.md.
    allow_package_managers: false,
  };
}

// Seed and drift both plan through this, so one environment yields one plan.
// The proxy URL comes from the resolved capability, never a second env read.
export function buildSeedPlanFromEnv(
  source: Parameters<typeof resolveCapabilitiesFromEnv>[0],
  deployEnv: string,
): SeedPlan {
  return buildSeedPlanFromCapabilities(resolveCapabilitiesFromEnv(source), deployEnv);
}

export function buildSeedPlanFromCapabilities(
  capabilities: Capabilities,
  deployEnv: string,
): SeedPlan {
  return buildSeedPlan({
    deployEnv,
    capabilities,
    mcpProxyUrl:
      capabilities.connectedApps.kind === 'composio'
        ? capabilities.connectedApps.proxyUrl
        : undefined,
  });
}
