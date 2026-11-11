// Which skills a workspace sees and a session loads: the picker, the Skills list, the inspector and new sessions.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  caller: { workspaceId: '', userId: 'owner', organizationId: 'org' },
  attachedSkillIds: [] as string[],
}));
// The caller resolves for real from the signed-in session and the seeded membership rows.
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => ({
    userId: state.caller.userId,
    organizationId: state.caller.organizationId,
  })),
);
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/observability', () => ({ captureException: vi.fn(), initPostHog: () => undefined }));
vi.mock('@/features/agents', () => {
  const client = {
    beta: {
      sessions: {
        // The session's agent snapshot: the skills it was created with.
        retrieve: async () => ({
          agent: {
            skills: state.attachedSkillIds.map((id) => ({
              type: 'custom',
              skill_id: id,
              version: '1',
            })),
          },
        }),
      },
    },
  };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});

import { listComposerSkills } from '@/features/chat/api/skills-picker';
import { getSkillDetail, listSkillsForWorkspace } from '@/features/skills/api/list-skills';
import { PRESET_SKILLS } from '@/features/skills/constants';
import { listAttachableSkills, listSessionSkillRefs } from '@/features/skills/server';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { seedChatSession } from './helpers/seed-chat-session';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const db = makeTestDb(pool);
const [APP_GUIDE, CREATE_A_SKILL] = PRESET_SKILLS;
const RETIRED = 'Removed Roadmap';

beforeAll(async () => applyMigrations(db));
afterAll(async () => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  state.attachedSkillIds = [];
  state.caller = { workspaceId: '', userId: 'owner', organizationId: 'org' };
  await seedUser(db, 'owner');
  await seedOrganization(db, 'org');
  await seedOrganization(db, 'other');
  state.caller.workspaceId = await seedWorkspace('org');
  await seedMember('owner', 'owner');
});

async function seedMember(userId: string, role: 'owner' | 'member'): Promise<void> {
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values (${`member_${userId}`}, 'org', ${userId}, ${role}, now())`,
  );
}

async function seedWorkspace(orgId: string): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into workspace (organization_id, name) values (${orgId}, ${orgId}) returning id`,
  );
  const id = rows.at(0)?.id;
  if (!id) throw new Error('Expected the inserted workspace');
  return id;
}

async function seedSkill(input: {
  workspaceId: string | null;
  name: string;
  kind?: 'custom' | 'preset';
  anthropicSkillId: string | null;
  status?: 'ready' | 'deleting';
  updatedAt?: string;
}): Promise<string> {
  const version = input.anthropicSkillId ? '1' : null;
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into skill (kind, owner_workspace_id, name, anthropic_skill_id, latest_version, status, updated_at)
        values (${input.kind ?? 'custom'}, ${input.workspaceId}, ${input.name}, ${input.anthropicSkillId},
                ${version}, ${input.status ?? 'ready'}, ${input.updatedAt ?? '2026-11-01'})
        returning id`,
  );
  const id = rows.at(0)?.id;
  if (!id) throw new Error('Expected the inserted skill');
  return id;
}

// A kept preset, a preset an old default left behind, and customs in every state.
async function seedMixedSkills(workspaceId: string) {
  const other = await seedWorkspace('other');
  const appGuide = await seedSkill({
    workspaceId: null,
    name: APP_GUIDE.name,
    kind: 'preset',
    anthropicSkillId: 'sk_guide',
  });
  const retired = await seedSkill({
    workspaceId: null,
    name: RETIRED,
    kind: 'preset',
    anthropicSkillId: 'sk_old',
  });
  await seedSkill({ workspaceId, name: 'Research', anthropicSkillId: 'sk_research' });
  await seedSkill({ workspaceId, name: 'Never published', anthropicSkillId: null });
  await seedSkill({
    workspaceId,
    name: 'Being deleted',
    anthropicSkillId: 'sk_gone',
    status: 'deleting',
  });
  await seedSkill({ workspaceId: other, name: 'Someone else', anthropicSkillId: 'sk_other' });
  return { appGuide, retired };
}

describe('what a session loads and the picker offers', () => {
  test('new sessions and the picker load only published, live, kept skills of this workspace', async () => {
    await seedMixedSkills(state.caller.workspaceId);
    const attachable = await listAttachableSkills({ workspaceId: state.caller.workspaceId });
    expect(attachable.map((skill) => skill.name).sort()).toEqual(
      [APP_GUIDE.name, 'Research'].sort(),
    );
    const refs = await listSessionSkillRefs({ workspaceId: state.caller.workspaceId });
    expect(refs.map((ref) => ref.id).sort()).toEqual(
      attachable.map((s) => s.anthropicSkillId).sort(),
    );
  });

  test('two rows naming one Anthropic skill attach it once, from the newest row', async () => {
    for (const [name, updatedAt] of [
      ['Old copy', '2026-10-01'],
      ['New copy', '2026-11-01'],
    ] as const) {
      await seedSkill({
        workspaceId: state.caller.workspaceId,
        name,
        anthropicSkillId: 'sk_same',
        updatedAt,
      });
    }
    const attachable = await listAttachableSkills({ workspaceId: state.caller.workspaceId });
    expect(attachable.map((skill) => skill.name)).toEqual(['New copy']);
  });

  test('on Home the picker lists every skill a new chat would load, presets first', async () => {
    await seedMixedSkills(state.caller.workspaceId);
    const listed = await listComposerSkills();
    expect(listed.map((skill) => skill.name)).toEqual([APP_GUIDE.name, 'Research']);
  });

  test('in a task the picker lists only the live skills that session was created with', async () => {
    await seedMixedSkills(state.caller.workspaceId);
    await seedSkill({
      workspaceId: state.caller.workspaceId,
      name: 'Added later',
      anthropicSkillId: 'sk_late',
    });
    const task = await seedChatSession(db, 'org', {
      createdByUserId: 'owner',
      workspaceMemoryAccess: 'read_write',
      anthropicSessionId: 'sesn_task',
    });
    // The session also names a skill that has since started deleting here.
    state.attachedSkillIds = ['sk_guide', 'sk_research', 'sk_gone'];
    const listed = await listComposerSkills(task.id);
    expect(listed.map((skill) => skill.name)).toEqual([APP_GUIDE.name, 'Research']);
  });

  test('a teammate cannot read the skills of a task someone else created', async () => {
    await seedUser(db, 'teammate');
    await seedMember('teammate', 'member');
    const task = await seedChatSession(db, 'org', {
      createdByUserId: 'owner',
      workspaceMemoryAccess: 'read_write',
      anthropicSessionId: 'sesn_shared',
      visibility: 'workspace',
    });
    state.caller = { ...state.caller, userId: 'teammate' };
    await expect(listComposerSkills(task.id)).rejects.toMatchObject({
      code: 'SESSION_NOT_WRITABLE',
    });
  });
});

describe('presets an old default left behind', () => {
  test('a retired preset is hidden from the Skills list and inspector, and its row is kept', async () => {
    const workspaceId = state.caller.workspaceId;
    await seedSkill({
      workspaceId: null,
      name: CREATE_A_SKILL.name,
      kind: 'preset',
      anthropicSkillId: 'sk_create',
    });
    const ids = await seedMixedSkills(workspaceId);
    const listed = await listSkillsForWorkspace({ workspaceId });
    expect(listed.map((item) => item.name)).not.toContain(RETIRED);
    expect(listed.map((item) => item.name)).toEqual(
      expect.arrayContaining([APP_GUIDE.name, CREATE_A_SKILL.name, 'Research']),
    );
    await expect(getSkillDetail({ workspaceId, skillId: ids.retired })).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
    });
    await expect(getSkillDetail({ workspaceId, skillId: ids.appGuide })).resolves.toMatchObject({
      name: APP_GUIDE.name,
      isPreset: true,
    });
    const presets = await db.execute<{ name: string }>(
      sql`select name from skill where kind = 'preset' order by name`,
    );
    expect(presets.rows.map((row) => row.name)).toContain(RETIRED);
  });

  test('a custom skill named like a retired preset stays listed and attached', async () => {
    const workspaceId = state.caller.workspaceId;
    await seedSkill({ workspaceId, name: RETIRED, anthropicSkillId: 'sk_my_roadmap' });
    expect((await listSkillsForWorkspace({ workspaceId })).map((item) => item.name)).toEqual([
      RETIRED,
    ]);
    expect((await listSessionSkillRefs({ workspaceId })).map((ref) => ref.id)).toEqual([
      'sk_my_roadmap',
    ]);
  });
});
