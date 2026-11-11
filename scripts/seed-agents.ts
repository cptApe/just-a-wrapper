// Seed agents and the shared environment per deployment, idempotently by name.
// Compare configured fields before updating so no-op runs preserve versions.
// Run pnpm seed:agents without a key for a dry run; with a key it writes live.
// See platform.claude.com/docs/en/managed-agents.

import Anthropic from '@anthropic-ai/sdk';
import {
  diffAgent,
  diffEnvironment,
  type FieldDiff,
} from '../src/features/agent-setup/lib/seed-diff.ts';
import {
  type AgentTool,
  buildSeedPlanFromEnv,
  type SeedPlan,
} from '../src/features/agent-setup/seed-plan.ts';

// Show disabled built-in tools in the dry-run plan so their policy is visible.
function describeTool(tool: AgentTool): string {
  if (tool.type === 'agent_toolset_20260401') {
    const disabled = tool.configs.filter((c) => c.enabled === false).map((c) => c.name);
    return disabled.length > 0 ? `${tool.type} (disabled: ${disabled.join(', ')})` : tool.type;
  }
  return tool.type;
}

function deployEnv(): string {
  // VERCEL_ENV is "production" | "preview" | "development" on Vercel; fall back
  // to a local label so a laptop run is clearly distinct from a deploy.
  return process.env.VERCEL_ENV || process.env.SEED_DEPLOY_ENV || 'local';
}

function printPlan(plan: SeedPlan): void {
  console.log(`\nSeed plan for environment: ${plan.deployEnv}\n`);
  console.log('Environment:');
  console.log(`  name: ${plan.environment.name}`);
  console.log(`  networking configuration: ${JSON.stringify(plan.environment.config.networking)}`);
  console.log('\nAgents:');
  for (const agent of plan.agents) {
    console.log(`  - ${agent.slug}: ${agent.name}`);
    console.log(`      description: ${agent.description}`);
    console.log(`      model: ${agent.model}`);
    console.log(`      tools: ${agent.tools.map(describeTool).join(', ')}`);
    console.log(`      mcp_servers: []`);
    console.log(`      multiagent: ${JSON.stringify(agent.multiagent)}`);
  }
  if (plan.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of plan.warnings) {
      console.log(`  ! ${w}`);
    }
  }
}

// Return the FULL live objects (not just ids): the no-op detection needs the
// live config to diff against the desired plan before deciding to update.
async function findEnvironmentByName(
  client: Anthropic,
  name: string,
): Promise<Anthropic.Beta.BetaEnvironment | null> {
  for await (const environment of client.beta.environments.list()) {
    if (environment.name === name) {
      return environment;
    }
  }
  return null;
}

async function findAgentByName(
  client: Anthropic,
  name: string,
): Promise<Anthropic.Beta.BetaManagedAgentsAgent | null> {
  for await (const agent of client.beta.agents.list()) {
    if (agent.name === name) {
      return agent;
    }
  }
  return null;
}

// One-line "field: live=… desired=…" for each diff, so a real change is auditable
// in the run output.
function printDiffs(diffs: FieldDiff[]): void {
  for (const d of diffs) {
    console.log(
      `      ~ ${d.field}: live=${JSON.stringify(d.live)} desired=${JSON.stringify(d.desired)}`,
    );
  }
}

async function seedLive(client: Anthropic, plan: SeedPlan): Promise<void> {
  // Environment: create if missing (names are unique per workspace, so a second
  // create would 409). Environments are not versioned, so we leave an existing
  // one as-is rather than mutating shared state under running sessions — but we
  // still fetch-and-diff to REPORT whether the live config matches the plan
  // (a no-op) or has drifted (needs manual reconciliation).
  const existingEnv = await findEnvironmentByName(client, plan.environment.name);
  let environmentId: string;
  if (existingEnv) {
    environmentId = existingEnv.id;
    if (existingEnv.config.type !== 'cloud') {
      console.log(
        `Environment ${environmentId} — live config type is "${existingEnv.config.type}", not cloud. Leaving as-is; reconcile manually.`,
      );
    } else {
      const envDiffs = diffEnvironment(plan.environment.config, existingEnv.config);
      if (envDiffs.length === 0) {
        console.log(`Environment ${environmentId} — no-op, config unchanged.`);
      } else if (process.argv.includes('--update-environment')) {
        // Opt-in reconcile: environments are not versioned and are shared by
        // running sessions, so mutating one is never the silent default — the
        // the person running the script passes the flag after reading the printed diff.
        await client.beta.environments.update(environmentId, {
          config: plan.environment.config,
        });
        console.log(
          `Environment ${environmentId} — UPDATED (${envDiffs.map((d) => d.field).join(', ')}):`,
        );
        printDiffs(envDiffs);
      } else {
        console.log(
          `Environment ${environmentId} — live config DIFFERS (${envDiffs.map((d) => d.field).join(', ')}). Leaving as-is (not versioned); re-run with --update-environment to reconcile:`,
        );
        printDiffs(envDiffs);
      }
    }
  } else {
    const created = await client.beta.environments.create({
      name: plan.environment.name,
      config: plan.environment.config,
    });
    environmentId = created.id;
    console.log(`Created environment ${environmentId}`);
  }

  const agentIds: Record<string, string> = {};
  for (const agentPlan of plan.agents) {
    const desired = {
      description: agentPlan.description,
      model: agentPlan.model,
      system: agentPlan.system,
      tools: agentPlan.tools,
      mcp_servers: agentPlan.mcp_servers,
      multiagent: agentPlan.multiagent,
    };
    const existing = await findAgentByName(client, agentPlan.name);
    if (existing) {
      // Fetch-and-diff: only update (which bumps the version) when the live
      // config actually differs from the plan. The live object echoes back more
      // than we send (model object, resolved tool config, …), so diffAgent
      // normalizes both sides — see src/features/agent-setup/lib/seed-diff.ts. Keeps one agent
      // per tier/env and makes a no-op re-run truly version-stable.
      const diffs = diffAgent(desired, existing);
      if (diffs.length === 0) {
        agentIds[agentPlan.slug] = existing.id;
        console.log(
          `${agentPlan.slug} agent ${existing.id} — no-op, version unchanged (version ${existing.version}).`,
        );
      } else {
        const updated = await client.beta.agents.update(existing.id, {
          version: existing.version,
          ...desired,
        });
        agentIds[agentPlan.slug] = updated.id;
        console.log(
          `Updated ${agentPlan.slug} agent ${updated.id} → version ${updated.version} (changed: ${diffs.map((d) => d.field).join(', ')}):`,
        );
        printDiffs(diffs);
      }
    } else {
      const created = await client.beta.agents.create({
        name: agentPlan.name,
        ...desired,
      });
      agentIds[agentPlan.slug] = created.id;
      console.log(`Created ${agentPlan.slug} agent ${created.id} (version ${created.version})`);
    }
  }

  console.log('\nPaste these into .env for this deploy environment:');
  console.log(`  ANTHROPIC_ENVIRONMENT_ID=${environmentId}`);
  for (const [slug, id] of Object.entries(agentIds)) {
    console.log(`  ${agentEnvVar(slug)}=${id}`);
  }

  warnOnStaleAgentEnv(agentIds);
}

// One env var per seeded record, derived from the plan's slugs (never a second
// hand-kept list).
function agentEnvVar(slug: string): string {
  return `ANTHROPIC_AGENT_ID_${slug.toUpperCase().replaceAll('-', '_')}`;
}

// The runtime resolves agents from ANTHROPIC_AGENT_ID_* — NOT from what this
// script just reconciled. A stale/missing env id means every session silently
// runs an agent this seed run never touched (that bug cost an evening), so the
// mismatch is shouted to stderr instead of buried in the paste-this block above.
function warnOnStaleAgentEnv(agentIds: Record<string, string>): void {
  const stale = Object.entries(agentIds)
    .map(([slug, seeded]) => ({
      envVar: agentEnvVar(slug),
      live: process.env[agentEnvVar(slug)],
      seeded,
    }))
    .filter(({ live, seeded }) => live !== seeded);
  if (stale.length === 0) {
    return;
  }
  console.error('\n!!! ============================================================');
  console.error('!!! STALE AGENT ENV — your .env does not match the seeded agents.');
  console.error('!!! Sessions will run a DIFFERENT agent than the one just seeded.');
  for (const { envVar, live, seeded } of stale) {
    console.error(`!!!   ${envVar}=${live ?? '(unset)'} but the seed-managed agent is ${seeded}`);
  }
  console.error('!!! Update .env with the ids above and restart the dev server.');
  console.error('!!! ============================================================\n');
}

async function main(): Promise<void> {
  const plan = buildSeedPlanFromEnv(process.env, deployEnv());

  printPlan(plan);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('\nDRY RUN — ANTHROPIC_API_KEY is not set. Nothing was created.');
    console.log('Set ANTHROPIC_API_KEY to apply this plan.\n');
    return;
  }

  console.log('\nApplying plan (ANTHROPIC_API_KEY is set)…\n');
  await seedLive(new Anthropic({ apiKey }), plan);
  console.log('\nDone.\n');
}

main().catch((error) => {
  // Top-level script boundary: surface the failure and exit non-zero. We
  // rethrow (rather than swallow) so the stack reaches the terminal and the
  // process exits with a failure code — this is a CLI entry point, not an app
  // request path with the captureException sink.
  process.exitCode = 1;
  throw error;
});
