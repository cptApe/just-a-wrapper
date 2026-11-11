// A stand-in for the Managed Agents HTTP API behind the real SDK: agents, deployments, deployment
// runs and sessions. Tests change `state` to steer it and read `writes` to see what reached it.
import { vi } from 'vitest';

type Json = Record<string, unknown>;

export type FakeDeploymentApi = ReturnType<typeof fakeDeploymentApi>;

export function fakeDeploymentApi() {
  const initial = () => ({
    agentSystem: 'Original prompt',
    status: 'active' as 'active' | 'paused',
    archivedAt: null as string | null,
    upcoming: ['2030-01-01T08:00:00Z'] as string[],
    reject: false,
    metadata: {} as Json,
    lastBody: {} as Json,
    // Holds a definition update until the test lets it through.
    updateGate: null as Promise<void> | null,
    onUpdateArrived: null as (() => void) | null,
    onCreate: null as (() => Promise<void>) | null,
    run: null as (() => Response | Promise<Response>) | null,
    sessions: new Map<string, Json>(),
    deploymentRuns: [] as Json[],
  });
  const state = initial();
  const writes: Array<{ method: string; path: string; body: Json }> = [];
  const deployment = () => ({
    id: 'depl_test',
    type: 'deployment',
    status: state.status,
    archived_at: state.archivedAt,
    metadata: state.metadata,
    schedule: {
      type: 'cron',
      expression: '0 8 * * *',
      timezone: 'UTC',
      upcoming_runs_at: state.upcoming,
    },
  });

  async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body: Json =
      request.method === 'GET' || !request.body ? {} : ((await request.json()) as Json);
    if (request.method !== 'GET') writes.push({ method: request.method, path, body });
    if (path.startsWith('/v1/agents/'))
      return Response.json({
        id: 'agent_test',
        version: 1,
        system: state.agentSystem,
        model: { id: 'test-model' },
        tools: [],
        mcp_servers: [],
        multiagent: null,
      });
    if (path.startsWith('/v1/deployments')) {
      if (state.reject)
        return Response.json(
          { type: 'error', error: { type: 'invalid_request_error', message: 'invalid cron' } },
          { status: 400 },
        );
      if (path === '/v1/deployments' && request.method === 'GET')
        return Response.json({ data: [], next_page: null });
      if (path === '/v1/deployments') {
        state.metadata = (body.metadata as Json) ?? {};
        state.lastBody = body;
        await state.onCreate?.();
        return Response.json(deployment());
      }
      if (path.endsWith('/pause')) state.status = 'paused';
      else if (path.endsWith('/unpause')) state.status = 'active';
      else if (path.endsWith('/archive')) state.archivedAt = new Date().toISOString();
      else if (path.endsWith('/run')) {
        if (!state.run) throw new Error('Unexpected run-now');
        return state.run();
      } else if (request.method === 'POST') {
        state.onUpdateArrived?.();
        await state.updateGate;
        state.lastBody = body;
      }
      return Response.json(deployment());
    }
    if (path === '/v1/deployment_runs')
      return Response.json({ data: state.deploymentRuns, next_page: null });
    if (path === '/v1/sessions' && request.method === 'GET')
      return Response.json({ data: [], next_page: null });
    if (path.startsWith('/v1/sessions/') && request.method === 'GET') {
      const session = state.sessions.get(path.slice('/v1/sessions/'.length));
      if (session) return Response.json(session);
    }
    throw new Error(`Unexpected HTTP request: ${request.method} ${path}`);
  }

  return {
    state,
    writes,
    /** The SDK client keeps the fetch it first saw, so one fake is reset between tests. */
    reset() {
      Object.assign(state, initial());
      writes.length = 0;
    },
    install() {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) =>
        handle(new Request(input, init)),
      );
    },
    /** The text of the system message the provider last stored for this deployment. */
    systemText(): string {
      const events = (state.lastBody.initial_events ?? []) as Array<{
        type: string;
        content?: Array<{ text: string }>;
      }>;
      const system = events.find((event) => event.type === 'system.message');
      return system?.content?.map((block) => block.text).join('') ?? '';
    },
  };
}
