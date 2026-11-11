// Connected-app tool approvals on real Postgres: whether a call runs, asks or is refused, and what an
// answer remembers. Composio's catalog is faked at fetch and Anthropic's event API at its client.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { resolveToolGate } from '@/features/permissions';
import {
  allowToolGloballyForMember,
  rememberToolApprovalForSession,
} from '@/features/permissions/api/approval-scopes';
import { setToolPermissions } from '@/features/permissions/api/tool-policies';
import { confirmToolUses } from '@/features/session-runtime/api/confirm-tool-use';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { writeGrantForTest } from './helpers/session-grant';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const upstream = vi.hoisted(() => ({ list: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    COMPOSIO_API_KEY: 'isolated-catalog-test',
    MCP_PROXY_URL: 'https://proxy.example.test/api/mcp/composio',
    MCP_PROXY_JWT_SECRET: 'proxy-secret',
  }),
);
vi.mock('@/features/agents', () => {
  const client = { beta: { sessions: { events: upstream } } };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});
vi.mock('@/lib/observability', () => ({ captureException: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => ({
    userId: 'user_gate_routing',
    organizationId: 'org_gate_routing',
  })),
);

const pool = makeTestPool();
const db = makeTestDb(pool);

const ORG = 'org_gate_routing';
const USER = 'user_gate_routing';
const SESSION = '00000000-0000-4000-8000-000000000001';
const WORKSPACE = randomUUID();
const WORKBENCH = 'COMPOSIO_REMOTE_WORKBENCH';
const EXECUTOR = 'COMPOSIO_MULTI_EXECUTE_TOOL';

const grant = writeGrantForTest({
  workspaceId: WORKSPACE,
  organizationId: ORG,
  userId: USER,
  sessionRowId: SESSION,
  anthropicSessionId: 'sess_gate_routing',
});

type Kind = 'chat' | 'task_run';
type Mode = 'ask' | 'auto';

async function seedSession(kind: Kind = 'chat', permissionMode: Mode = 'ask'): Promise<void> {
  await seedUser(db, USER);
  await seedOrganization(db, ORG);
  await db.execute(
    sql`insert into workspace (id, organization_id, name) values (${WORKSPACE}, ${ORG}, 'Gate test')`,
  );
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('creator', ${ORG}, ${USER}, 'admin', now())`,
  );
  await db.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id)
        values (${ORG}, ${USER}, 'composio_gate_routing')`,
  );
  await db.execute(
    sql`insert into session (workspace_memory_access, id, workspace_id, tier, created_by_user_id, kind, permission_mode, anthropic_session_id)
        values ('read_write', ${SESSION}, ${WORKSPACE}, 'default', ${USER}, ${kind}, ${permissionMode}, 'sess_gate_routing')`,
  );
}

async function setPolicy(toolName: string, policy: 'allow' | 'ask' | 'block', toolkit = 'gmail') {
  await db.execute(
    sql`insert into tool_permission (organization_id, user_id, toolkit, tool_name, policy)
        values (${ORG}, ${USER}, ${toolkit}, ${toolName}, ${policy})`,
  );
}

const gate = (toolName: string, toolInput?: unknown) =>
  resolveToolGate({ organizationId: ORG, userId: USER, sessionId: SESSION, toolName, toolInput });

async function rememberedTools() {
  const rows = await db.execute<{ tool_name: string }>(
    sql`select tool_name from session_tool_approval where session_id = ${SESSION} order by tool_name`,
  );
  return rows.rows.map((row) => row.tool_name);
}

function upstreamToolUses(events: Array<Record<string, unknown>>) {
  return {
    data: events.map((event) => ({
      type: 'agent.tool_use',
      evaluated_permission: 'ask',
      ...event,
    })),
    async *[Symbol.asyncIterator]() {
      yield* this.data;
    },
  };
}

beforeAll(async () => {
  await applyMigrations(db);
});
beforeEach(async () => {
  await truncateAll(db);
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString(),
    );
    expect(url.pathname).toBe('/api/v3.1/tools');
    return Response.json({
      items: [
        { slug: 'GMAIL_SEND_EMAIL', name: 'Send', description: '', tags: ['createHint'] },
        { slug: 'GMAIL_GET_CONTACTS', name: 'Get', description: '', tags: ['destructiveHint'] },
        { slug: 'GMAIL_FETCH_EMAILS', name: 'Fetch', description: '', tags: ['readOnlyHint'] },
      ],
      total_items: 3,
    });
  });
  upstream.list.mockReset().mockResolvedValue(
    upstreamToolUses([
      {
        id: 'tool_1',
        name: 'GMAIL_SEND_EMAIL',
        input: { to: 'a@example.test' },
        session_thread_id: 'thread_1',
      },
      {
        id: 'tool_2',
        name: EXECUTOR,
        input: { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS', arguments: {} }] },
      },
    ]),
  );
  upstream.send.mockReset().mockResolvedValue({});
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await pool.end();
});

describe('whether a connected-app call runs, asks or is refused', () => {
  test('a call from a session the gate cannot find asks a person', async () => {
    await expect(gate('GMAIL_FETCH_EMAILS')).resolves.toBe('gate');
  });

  // allow runs, gate asks the person, deny refuses one readable call, refuse stops an unattended run.
  test.each<{
    case: string;
    kind: Kind;
    mode: Mode;
    policies: Array<[string, 'allow' | 'ask' | 'block']>;
    tool: string;
    input?: unknown;
    expected: 'allow' | 'gate' | 'deny' | 'refuse';
  }>([
    {
      case: 'a write with no row asks even in an unattended auto run',
      kind: 'task_run',
      mode: 'auto',
      policies: [],
      tool: 'GMAIL_SEND_EMAIL',
      expected: 'gate',
    },
    {
      case: 'a read with no row asks in an asking task',
      kind: 'task_run',
      mode: 'ask',
      policies: [],
      tool: 'GMAIL_FETCH_EMAILS',
      expected: 'gate',
    },
    {
      case: 'a read with no row runs in an auto chat',
      kind: 'chat',
      mode: 'auto',
      policies: [],
      tool: 'GMAIL_FETCH_EMAILS',
      expected: 'allow',
    },
    {
      case: 'a catalog write tag beats a read-looking name',
      kind: 'chat',
      mode: 'auto',
      policies: [],
      tool: 'GMAIL_GET_CONTACTS',
      expected: 'gate',
    },
    {
      case: 'the workbench is refused unattended while any action is blocked',
      kind: 'task_run',
      mode: 'auto',
      policies: [['GMAIL_SEND_EMAIL', 'block']],
      tool: WORKBENCH,
      input: { code: 'send_email()' },
      expected: 'refuse',
    },
    {
      case: 'an executor input the parser cannot fully read is refused unattended',
      kind: 'task_run',
      mode: 'auto',
      policies: [['GMAIL_SEND_EMAIL', 'block']],
      tool: EXECUTOR,
      input: { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }, { slug: 'GMAIL_SEND_EMAIL' }] },
      expected: 'refuse',
    },
    {
      case: 'a readable batch holding a blocked action is denied',
      kind: 'task_run',
      mode: 'auto',
      policies: [
        ['GMAIL_SEND_EMAIL', 'block'],
        ['GMAIL_FETCH_EMAILS', 'allow'],
      ],
      tool: EXECUTOR,
      input: { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }, { tool_slug: 'GMAIL_SEND_EMAIL' }] },
      expected: 'deny',
    },
    {
      case: 'with no Block anywhere the unattended workbench runs',
      kind: 'task_run',
      mode: 'auto',
      policies: [['GMAIL_SEND_EMAIL', 'ask']],
      tool: WORKBENCH,
      input: {},
      expected: 'allow',
    },
    {
      case: 'read-only meta-tools are never refused',
      kind: 'task_run',
      mode: 'auto',
      policies: [['GMAIL_SEND_EMAIL', 'block']],
      tool: 'COMPOSIO_SEARCH_TOOLS',
      input: { queries: [] },
      expected: 'allow',
    },
    {
      case: 'in a chat the workbench asks while any action is blocked',
      kind: 'chat',
      mode: 'auto',
      policies: [['GMAIL_SEND_EMAIL', 'block']],
      tool: WORKBENCH,
      input: {},
      expected: 'gate',
    },
    {
      case: 'an asking task asks for the workbench while any action is blocked',
      kind: 'task_run',
      mode: 'ask',
      policies: [['GMAIL_SEND_EMAIL', 'block']],
      tool: WORKBENCH,
      input: {},
      expected: 'gate',
    },
    {
      case: 'with no Block an auto chat runs the workbench',
      kind: 'chat',
      mode: 'auto',
      policies: [['GMAIL_SEND_EMAIL', 'ask']],
      tool: WORKBENCH,
      input: {},
      expected: 'allow',
    },
    {
      case: 'with no Block an asking chat asks for the workbench',
      kind: 'chat',
      mode: 'ask',
      policies: [['GMAIL_SEND_EMAIL', 'ask']],
      tool: WORKBENCH,
      input: {},
      expected: 'gate',
    },
  ])('$case', async ({ kind, mode, policies, tool, input, expected }) => {
    await seedSession(kind, mode);
    for (const [name, policy] of policies) await setPolicy(name, policy);
    await expect(gate(tool, input)).resolves.toBe(expected);
  });

  test('a policy row for every tool at once cannot be stored', async () => {
    await seedSession();
    await expect(setPolicy('*', 'allow')).rejects.toThrow();
    await expect(setPolicy('*:write', 'block')).rejects.toThrow();
  });
});

describe('what an approval remembers', () => {
  test('Always for this task skips the next ask, but a Block still wins over it', async () => {
    await seedSession();
    await rememberToolApprovalForSession({
      sessionId: SESSION,
      toolName: 'GMAIL_SEND_EMAIL',
      toolInput: {},
    });
    expect(await rememberedTools()).toEqual(['GMAIL_SEND_EMAIL']);
    await expect(gate('GMAIL_SEND_EMAIL')).resolves.toBe('allow');

    await setPolicy('GMAIL_SEND_EMAIL', 'block');
    await expect(gate('GMAIL_SEND_EMAIL')).resolves.toBe('deny');
  });

  test('Always everywhere writes the exact per-action row the Tools page reads', async () => {
    await seedSession();
    await allowToolGloballyForMember({
      organizationId: ORG,
      userId: USER,
      toolName: EXECUTOR,
      toolInput: { tools: [{ tool_slug: 'GMAIL_SEND_EMAIL' }] },
    });

    const rows = await db.execute(
      sql`select toolkit, tool_name, policy from tool_permission
          where organization_id = ${ORG} and user_id = ${USER}`,
    );
    expect(rows.rows).toEqual([
      { toolkit: 'gmail', tool_name: 'GMAIL_SEND_EMAIL', policy: 'allow' },
    ]);
  });

  test('a task approval is never stored under a meta-tool name, and an old one is ignored', async () => {
    await seedSession('task_run', 'ask');
    await expect(
      rememberToolApprovalForSession({ sessionId: SESSION, toolName: WORKBENCH, toolInput: {} }),
    ).rejects.toThrow();
    await expect(
      rememberToolApprovalForSession({
        sessionId: SESSION,
        toolName: EXECUTOR,
        toolInput: { tools: [{ slug: 'GMAIL_SEND_EMAIL' }] },
      }),
    ).rejects.toThrow();
    expect(await rememberedTools()).toEqual([]);

    await db.execute(
      sql`insert into session_tool_approval (session_id, tool_name) values (${SESSION}, ${WORKBENCH})`,
    );
    await expect(gate(WORKBENCH, {})).resolves.toBe('gate');
  });
});

describe('answering a connected-app approval', () => {
  test('a batch of approvals reaches Anthropic and remembers the actions it resolved, after the send', async () => {
    await seedSession();
    upstream.send.mockImplementation(async () => {
      expect(await rememberedTools()).not.toContain('GMAIL_FETCH_EMAILS');
    });
    expect(
      await confirmToolUses({
        grant,
        decisions: [
          { toolUseId: 'tool_1', result: 'allow', scope: 'session' },
          { toolUseId: 'tool_2', result: 'allow', scope: 'session' },
        ],
      }),
    ).toEqual([
      { toolUseId: 'tool_1', status: 'sent', scopeStatus: 'remembered' },
      { toolUseId: 'tool_2', status: 'sent', scopeStatus: 'remembered' },
    ]);
    expect(upstream.send.mock.calls[0]?.[1]).toEqual({
      events: [
        {
          type: 'user.tool_confirmation',
          tool_use_id: 'tool_1',
          result: 'allow',
          session_thread_id: 'thread_1',
        },
      ],
    });
    expect(await rememberedTools()).toEqual(['GMAIL_FETCH_EMAILS', 'GMAIL_SEND_EMAIL']);
  });

  test('approving an opaque workbench call runs it once and remembers nothing', async () => {
    await seedSession();
    upstream.list.mockResolvedValue(
      upstreamToolUses([{ id: 'tool_1', name: WORKBENCH, input: { code: 'run()' } }]),
    );
    expect(
      await confirmToolUses({
        grant,
        decisions: [{ toolUseId: 'tool_1', result: 'allow', scope: 'session' }],
      }),
    ).toEqual([{ toolUseId: 'tool_1', status: 'sent', scopeStatus: 'failed' }]);
    expect(await rememberedTools()).toEqual([]);
  });

  test.each([
    {
      case: 'an answer to a call the session never asked about',
      toolUseId: 'missing',
      sendFails: false,
    },
    { case: 'an answer Anthropic rejects', toolUseId: 'tool_1', sendFails: true },
  ])('$case fails and leaves no remembered permission', async ({ toolUseId, sendFails }) => {
    await seedSession();
    if (sendFails) upstream.send.mockRejectedValue(new Error('rejected'));
    expect(
      await confirmToolUses({
        grant,
        decisions: [{ toolUseId, result: 'allow', scope: 'session' }],
      }),
    ).toEqual([{ toolUseId, status: 'failed' }]);
    expect(await rememberedTools()).toEqual([]);
  });

  test('a creator demoted from admin cannot approve on a task that writes workspace memory', async () => {
    await seedSession();
    await db.execute(sql`update member set role = 'member' where user_id = ${USER}`);
    await expect(
      confirmToolUses({
        grant,
        decisions: [{ toolUseId: 'tool_1', result: 'allow', scope: 'once' }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(upstream.send).not.toHaveBeenCalled();
  });

  test('when remembering fails after the send, the answered gate is not sent again', async () => {
    await seedSession();
    // The session row disappears once the gate is answered, so remembering its scope fails.
    upstream.send.mockImplementation(async () => {
      await db.execute(sql`delete from session where id = ${SESSION}`);
    });
    expect(
      await confirmToolUses({
        grant,
        decisions: [{ toolUseId: 'tool_1', result: 'allow', scope: 'session' }],
      }),
    ).toEqual([{ toolUseId: 'tool_1', status: 'sent', scopeStatus: 'failed' }]);
    expect(upstream.send).toHaveBeenCalledTimes(1);
  });
});

describe('saving tool permissions from the Tools page', () => {
  async function policies() {
    const rows = await db.execute<{ user_id: string; tool_name: string; policy: string }>(
      sql`select user_id, tool_name, policy from tool_permission order by user_id, tool_name`,
    );
    return rows.rows;
  }

  test("a save is all or nothing, touches only the caller, and refuses another app's action", async () => {
    await seedSession();
    await seedUser(db, 'teammate');
    await db.execute(
      sql`insert into workspace_member (organization_id, user_id, composio_user_id) values (${ORG}, 'teammate', 'composio_teammate')`,
    );
    await db.execute(
      sql`insert into tool_permission (organization_id, user_id, toolkit, tool_name, policy) values (${ORG}, 'teammate', 'gmail', 'GMAIL_SEND_EMAIL', 'block')`,
    );
    await setPolicy('GMAIL_FETCH_EMAILS', 'ask');
    const before = await policies();
    const save = (changes: Array<[string, 'allow' | 'ask' | 'block']>) =>
      setToolPermissions({
        toolkit: 'gmail',
        changes: changes.map(([toolName, policy]) => ({
          target: { kind: 'tool' as const, toolName },
          policy,
        })),
      });
    const edit: Array<[string, 'allow' | 'ask' | 'block']> = [
      ['GMAIL_SEND_EMAIL', 'allow'],
      ['GMAIL_FETCH_EMAILS', 'block'],
      ['GMAIL_GET_CONTACTS', 'allow'],
    ];

    await db.execute(
      sql`create function reject_contacts_policy() returns trigger language plpgsql as $$ begin if new.tool_name = 'GMAIL_GET_CONTACTS' then raise exception 'write failed'; end if; return new; end $$`,
    );
    await db.execute(
      sql`create trigger reject_contacts_policy before insert or update on tool_permission for each row execute function reject_contacts_policy()`,
    );
    try {
      await expect(save(edit)).rejects.toBeDefined();
      expect(await policies()).toEqual(before);
    } finally {
      await db.execute(sql`drop trigger reject_contacts_policy on tool_permission`);
      await db.execute(sql`drop function reject_contacts_policy()`);
    }

    await expect(save([['SLACK_SEND_MESSAGE', 'allow']])).rejects.toMatchObject({
      cause: { code: 'TOOL_NOT_FOUND' },
    });

    await save(edit);
    expect(await policies()).toEqual([
      { user_id: 'teammate', tool_name: 'GMAIL_SEND_EMAIL', policy: 'block' },
      { user_id: USER, tool_name: 'GMAIL_FETCH_EMAILS', policy: 'block' },
      { user_id: USER, tool_name: 'GMAIL_GET_CONTACTS', policy: 'allow' },
      { user_id: USER, tool_name: 'GMAIL_SEND_EMAIL', policy: 'allow' },
    ]);
  });
});
