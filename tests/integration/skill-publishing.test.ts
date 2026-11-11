// Skill publishing: the local skill row and its Anthropic copy stay in step through the agent tools, crashes, races and provider errors.
import { randomUUID } from 'node:crypto';
import { APIError } from '@anthropic-ai/sdk';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// The Skills API at the SDK boundary; the real adapter and feature code run on top of it.
const sdk = vi.hoisted(() => ({
  createSkill: vi.fn(),
  listSkills: vi.fn(),
  deleteSkill: vi.fn(),
  createVersion: vi.fn(),
  deleteVersion: vi.fn(),
  listVersions: vi.fn(),
}));
vi.mock('@/features/agents', () => {
  const client = {
    beta: {
      skills: {
        create: sdk.createSkill,
        list: sdk.listSkills,
        delete: sdk.deleteSkill,
        versions: { create: sdk.createVersion, delete: sdk.deleteVersion, list: sdk.listVersions },
      },
    },
  };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});

import { skill } from '@/db/schema';
import { anthropicSkills } from '@/features/skills/api/anthropic-skills';
import { createCustomSkill } from '@/features/skills/api/create-custom-skill';
import { deleteCustomSkill } from '@/features/skills/api/delete-custom-skill';
import { listSessionSkillRefs, listSkillsForWorkspace } from '@/features/skills/api/list-skills';
import { ensurePresetSkills } from '@/features/skills/api/preset-skills';
import {
  claimPublication,
  finishPublication,
  reserveSkill,
} from '@/features/skills/api/skill-transitions';
import { updateCustomSkill } from '@/features/skills/api/update-custom-skill';
import { deleteSkillTool } from '@/features/tools/custom-tools/delete-skill';
import { listSkillsTool } from '@/features/tools/custom-tools/list-skills';
import { saveSkillTool } from '@/features/tools/custom-tools/save-skill';
import { updateSkillTool } from '@/features/tools/custom-tools/update-skill';
import { AppError } from '@/lib/errors';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const db = makeTestDb(pool);
const AUTHOR = 'author';
let workspaceId: string;

beforeAll(async () => applyMigrations(db));
afterAll(async () => pool.end());
beforeEach(async () => {
  vi.restoreAllMocks();
  await truncateAll(db);
  await seedUser(db, AUTHOR);
  workspaceId = await seedWorkspace('skills');
  for (const fn of Object.values(sdk)) fn.mockReset();
  sdk.listSkills.mockImplementation(async function* () {});
  sdk.createSkill.mockResolvedValue({ id: 'remote_skill_renamed', latest_version: 'version_1' });
  sdk.createVersion.mockResolvedValue({ version: 'version_2' });
  sdk.deleteVersion.mockResolvedValue({ id: 'version_1', type: 'skill_version_deleted' });
  sdk.deleteSkill.mockResolvedValue({ id: 'remote_skill', type: 'skill_deleted' });
  sdk.listVersions.mockImplementation(async function* () {
    yield { version: 'version_1' };
    yield { version: 'version_2' };
  });
});

async function seedWorkspace(organizationId: string): Promise<string> {
  await seedOrganization(db, organizationId);
  return requiredRow(
    (
      await db.execute<{ id: string }>(
        sql`insert into workspace (organization_id, name) values (${organizationId}, ${organizationId}) returning id`,
      )
    ).rows.at(0),
  ).id;
}

async function seedSkill(input: {
  workspaceId: string | null;
  name: string;
  description?: string;
  kind?: 'custom' | 'preset';
  anthropicSkillId?: string;
}) {
  const { id } = requiredRow(
    (
      await db.execute<{ id: string }>(sql`
      insert into skill (
        kind, owner_workspace_id, name, description, anthropic_skill_id, latest_version, updated_at
      ) values (
        ${input.kind ?? 'custom'}, ${input.workspaceId}, ${input.name}, ${input.description ?? null},
        ${input.anthropicSkillId ?? null}, ${input.anthropicSkillId ? 'version_1' : null},
        '2026-08-31T10:00:00.000Z'
      ) returning id
    `)
    ).rows.at(0),
  );
  await db.execute(sql`
    insert into skill_file (skill_id, path, content)
    values (${id}, 'SKILL.md', ${`---\nname: ${input.name}\n---\nOriginal`})
  `);
  return id;
}

async function skillRow(id: string) {
  return (await db.select().from(skill).where(eq(skill.id, id))).at(0);
}

function toolContext() {
  return { workspaceId, userId: AUTHOR, sessionId: 'sess_skill_tools', sessionRowId: randomUUID() };
}

describe('skill tools the agent calls', () => {
  test('saving a skill again keeps the member who first saved it as its author', async () => {
    sdk.createSkill.mockResolvedValue({ id: 'remote_skill_new', latest_version: 'version_1' });
    const content = '---\nname: Weekly digest\n---\nDraft';
    const ctx = toolContext();
    await saveSkillTool.handler(
      { name: 'Weekly digest', files: [{ path: 'SKILL.md', content }] },
      ctx,
    );
    await saveSkillTool.handler(
      { name: 'Weekly digest', files: [{ path: 'SKILL.md', content: `${content} 2` }] },
      ctx,
    );
    const rows = await db.execute<{ created_by_user_id: string | null }>(
      sql`select created_by_user_id from skill where owner_workspace_id = ${workspaceId}`,
    );
    expect(rows.rows).toEqual([{ created_by_user_id: AUTHOR }]);
  });

  test('list_skills shows only matching skills this workspace saved, not presets', async () => {
    await seedSkill({ workspaceId, name: 'Monthly report', description: 'Prepare the report.' });
    await seedSkill({ workspaceId, name: 'Weekly summary', description: 'Summarize the week.' });
    await seedSkill({ workspaceId: null, name: 'Central preset', kind: 'preset' });
    await expect(listSkillsTool.handler({ query: 'monthly' }, toolContext())).resolves.toEqual({
      skills: [
        {
          name: 'Monthly report',
          description: 'Prepare the report.',
          updatedAt: '2026-08-31T10:00:00.000Z',
        },
      ],
    });
  });

  test('renaming a skill publishes a new Anthropic skill and replaces the local name and files', async () => {
    const skillId = await seedSkill({
      workspaceId,
      name: 'Monthly report',
      anthropicSkillId: 'remote_skill',
    });
    await expect(
      updateSkillTool.handler(
        {
          current_name: 'Monthly report',
          name: 'Monthly client report',
          description: 'Prepare the revised client report.',
          files: [
            { path: 'SKILL.md', content: '---\nname: monthly-report\n---\nRevised' },
            { path: 'references/format.md', content: 'Use the new format.' },
          ],
        },
        toolContext(),
      ),
    ).resolves.toMatchObject({ updated: true, skillId, version: 'version_1' });
    expect(sdk.createVersion).not.toHaveBeenCalled();
    expect(sdk.deleteSkill).not.toHaveBeenCalled();
    expect(await skillRow(skillId)).toMatchObject({
      name: 'Monthly client report',
      description: 'Prepare the revised client report.',
      latestVersion: 'version_1',
      anthropicSkillId: 'remote_skill_renamed',
    });
    const files = await db.execute<{ path: string }>(
      sql`select path from skill_file where skill_id = ${skillId} order by path`,
    );
    expect(files.rows.map((file) => file.path)).toEqual(['SKILL.md', 'references/format.md']);
  });

  test('renaming onto a name another skill holds is refused before anything is published', async () => {
    await seedSkill({ workspaceId, name: 'Monthly report', anthropicSkillId: 'remote_skill' });
    await seedSkill({ workspaceId, name: 'Monthly client report' });
    await expect(
      updateSkillTool.handler(
        {
          current_name: 'Monthly report',
          name: 'Monthly client report',
          files: [{ path: 'SKILL.md', content: '# Revised' }],
        },
        toolContext(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(sdk.createSkill).not.toHaveBeenCalled();
    expect(sdk.deleteSkill).not.toHaveBeenCalled();
  });

  test('a rename that loses a race to a concurrent edit keeps that edit’s files and Anthropic skill', async () => {
    const skillId = await seedSkill({
      workspaceId,
      name: 'Monthly report',
      anthropicSkillId: 'remote_skill',
    });
    sdk.createSkill.mockImplementationOnce(async () => {
      await db.execute(sql`
        update skill
        set latest_version = 'version_concurrent', updated_at = now(), revision = revision + 1
        where id = ${skillId}
      `);
      return { id: 'remote_skill_renamed', latest_version: 'version_1' };
    });
    await expect(
      updateSkillTool.handler(
        {
          current_name: 'Monthly report',
          name: 'Monthly client report',
          files: [{ path: 'SKILL.md', content: '---\nname: monthly-report\n---\nRevised' }],
        },
        toolContext(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(sdk.deleteSkill).not.toHaveBeenCalled();
    expect(await skillRow(skillId)).toMatchObject({
      name: 'Monthly client report',
      anthropicSkillId: 'remote_skill',
      latestVersion: 'version_concurrent',
    });
    const files = await db.execute<{ content: string }>(
      sql`select content from skill_file where skill_id = ${skillId}`,
    );
    expect(files.rows).toEqual([{ content: '---\nname: Monthly report\n---\nOriginal' }]);
  });

  test('delete_skill removes every Anthropic version and the skill before the local row', async () => {
    const skillId = await seedSkill({
      workspaceId,
      name: 'Old report',
      anthropicSkillId: 'remote_skill',
    });
    await expect(deleteSkillTool.handler({ name: 'Old report' }, toolContext())).resolves.toEqual({
      deleted: true,
      name: 'Old report',
    });
    expect(sdk.deleteVersion.mock.calls).toEqual([
      ['version_1', { skill_id: 'remote_skill' }],
      ['version_2', { skill_id: 'remote_skill' }],
    ]);
    expect(sdk.deleteSkill).toHaveBeenCalledWith('remote_skill');
    expect(await skillRow(skillId)).toBeUndefined();
  });

  test('delete_skill finishes when one Anthropic version is already gone', async () => {
    const skillId = await seedSkill({
      workspaceId,
      name: 'Stale report',
      anthropicSkillId: 'remote_skill',
    });
    sdk.deleteVersion
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 404 }))
      .mockResolvedValue({ id: 'version_2', type: 'skill_version_deleted' });
    await expect(
      deleteSkillTool.handler({ name: 'Stale report' }, toolContext()),
    ).resolves.toMatchObject({ deleted: true });
    expect(sdk.deleteVersion).toHaveBeenCalledTimes(2);
    expect(sdk.deleteSkill).toHaveBeenCalledWith('remote_skill');
    expect(await skillRow(skillId)).toBeUndefined();
  });

  test('delete_skill does not delete a replacement a concurrent rename committed', async () => {
    const skillId = await seedSkill({
      workspaceId,
      name: 'Monthly report',
      anthropicSkillId: 'remote_skill',
    });
    sdk.deleteSkill.mockImplementationOnce(async () => {
      await db.execute(sql`
        update skill
        set name = 'Monthly client report', anthropic_skill_id = 'remote_skill_renamed',
            latest_version = 'version_1', revision = revision + 1, updated_at = now()
        where id = ${skillId}
      `);
      return { id: 'remote_skill', type: 'skill_deleted' };
    });
    await expect(
      deleteSkillTool.handler({ name: 'Monthly report' }, toolContext()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await skillRow(skillId)).toMatchObject({
      name: 'Monthly client report',
      anthropicSkillId: 'remote_skill_renamed',
    });
  });
});

describe('publication recovery', () => {
  const files = [{ path: 'SKILL.md', content: '# Guide' }];
  // Anthropic skills by display title, as the adapter would find them.
  const remote = new Map<string, { skillId: string; version: string }>();

  beforeEach(() => {
    remote.clear();
    vi.spyOn(anthropicSkills, 'findSkillByTitle').mockImplementation(
      async (title) => remote.get(title) ?? null,
    );
    vi.spyOn(anthropicSkills, 'createSkill').mockImplementation(async ({ displayTitle }) => {
      if (remote.has(displayTitle))
        throw new APIError(400, undefined, 'Duplicate title', new Headers());
      const pushed = { skillId: `remote_${remote.size}`, version: '1' };
      remote.set(displayTitle, pushed);
      return pushed;
    });
    vi.spyOn(anthropicSkills, 'createVersion').mockResolvedValue({ version: '2' });
    vi.spyOn(anthropicSkills, 'deleteSkill').mockResolvedValue(undefined);
  });

  function input() {
    return { workspaceId, userId: AUTHOR, name: 'Guide', files };
  }
  async function readRow(id: string) {
    const row = await skillRow(id);
    if (!row) throw new Error('Missing skill');
    return row;
  }
  function publication() {
    return {
      token: crypto.randomUUID(),
      name: 'Guide',
      description: null,
      directory: 'guide',
      files,
      sourceHash: null,
    };
  }
  function reserve() {
    return reserveSkill(
      { kind: 'custom', ownerWorkspaceId: workspaceId, name: 'Guide' },
      publication(),
    );
  }

  test.each([
    [
      'the frontmatter name',
      '---\nname: Custom Skill\ndescription: d\n---\n\n# Custom Skill\n',
      'custom-skill',
    ],
    ['the display name when there is no frontmatter', '# No frontmatter here\n', 'ux-verify-skill'],
  ])('the uploaded skill folder is named from %s, or Anthropic rejects it', async (_case, content, directory) => {
    await createCustomSkill({
      ...input(),
      name: 'UX Verify Skill',
      files: [{ path: 'SKILL.md', content }],
    });
    expect(anthropicSkills.createSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        displayTitle: expect.stringMatching(/^just-a-wrapper:/),
        directory,
      }),
    );
  });

  test('creating a skill under a name already taken is refused before anything is published', async () => {
    await seedSkill({ workspaceId, name: 'Guide', anthropicSkillId: 'remote_existing' });
    await expect(createCustomSkill(input())).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(anthropicSkills.createSkill).not.toHaveBeenCalled();
  });

  test('the same skill name in two workspaces gets two separate Anthropic skills', async () => {
    const first = await createCustomSkill(input());
    const other = await seedWorkspace('second');
    const second = await createCustomSkill({ ...input(), workspaceId: other });
    expect(second.anthropicSkillId).not.toBe(first.anthropicSkillId);
  });

  test('a crash after reservation resumes the same publication instead of publishing twice', async () => {
    const reserved = await reserve();
    const created = await createCustomSkill(input());
    expect(created.id).toBe(reserved?.id);
    expect(remote.size).toBe(1);
    expect((await readRow(created.id)).status).toBe('ready');
  });

  test('a crash after Anthropic created the skill adopts it on retry', async () => {
    const reserved = await reserve();
    if (!reserved?.publication) throw new Error('Missing reservation');
    remote.set(`just-a-wrapper:${reserved.publication.token}`, {
      skillId: 'already_created',
      version: '1',
    });
    const created = await createCustomSkill(input());
    expect(created.anthropicSkillId).toBe('already_created');
  });

  test('an Anthropic skill left without its first version is repaired on publish', async () => {
    vi.mocked(anthropicSkills.createSkill).mockRejectedValueOnce(
      new APIError(400, undefined, 'Duplicate title', new Headers()),
    );
    vi.mocked(anthropicSkills.findSkillByTitle).mockResolvedValueOnce({
      skillId: 'incomplete',
      version: null,
    });
    vi.mocked(anthropicSkills.createVersion).mockResolvedValue({ version: 'repaired' });
    const created = await createCustomSkill(input());
    expect(created).toMatchObject({ anthropicSkillId: 'incomplete', latestVersion: 'repaired' });
  });

  test('a create Anthropic rejects frees the name for corrected content', async () => {
    vi.mocked(anthropicSkills.createSkill).mockRejectedValueOnce(
      new APIError(400, undefined, 'Invalid frontmatter', new Headers()),
    );
    await expect(createCustomSkill(input())).rejects.toThrow();
    expect(await db.select().from(skill)).toEqual([]);
    await expect(
      createCustomSkill({ ...input(), files: [{ path: 'SKILL.md', content: '# Fixed' }] }),
    ).resolves.toMatchObject({ name: 'Guide' });
  });

  test('missing provider configuration frees the name of a new skill', async () => {
    vi.mocked(anthropicSkills.createSkill).mockRejectedValueOnce(
      new AppError('INTEGRATION_NOT_CONNECTED', 'Missing provider', {}),
    );
    await expect(createCustomSkill(input())).rejects.toThrow();
    expect(await db.select().from(skill)).toEqual([]);
  });

  test.each([
    408, 409, 429, 500,
  ])('a provider %s leaves the publication to finish on retry', async (status) => {
    vi.mocked(anthropicSkills.createSkill).mockRejectedValueOnce(
      new APIError(status, undefined, 'Retry', new Headers()),
    );
    await expect(createCustomSkill(input())).rejects.toThrow();
    expect((await db.select().from(skill)).at(0)?.status).toBe('publishing');
    await expect(createCustomSkill(input())).resolves.toMatchObject({ status: 'ready' });
  });

  test('a content edit adds a version to the same Anthropic skill', async () => {
    const created = await createCustomSkill(input());
    const updated = await updateCustomSkill({
      ...input(),
      skillId: created.id,
      files: [{ path: 'SKILL.md', content: '# New' }],
    });
    expect(updated).toMatchObject({
      anthropicSkillId: created.anthropicSkillId,
      latestVersion: '2',
    });
    expect((await readRow(created.id)).retainedSkillIds).toEqual([]);
  });

  test('a rename keeps the old Anthropic skill that running sessions still use', async () => {
    const created = await createCustomSkill(input());
    const claimed = await claimPublication(await readRow(created.id), {
      ...publication(),
      name: 'Renamed',
    });
    expect(await listSessionSkillRefs({ workspaceId })).toEqual([
      { id: created.anthropicSkillId, kind: 'custom', version: created.latestVersion },
    ]);
    const completed = await finishPublication(claimed);
    expect(completed.retainedSkillIds).toContain(created.anthropicSkillId);
    expect(anthropicSkills.deleteSkill).not.toHaveBeenCalled();
    const replay = await finishPublication(claimed);
    expect(replay.revision).toBe(completed.revision);
    const ready = await db
      .select()
      .from(skill)
      .where(and(eq(skill.id, completed.id), eq(skill.status, 'ready')));
    expect(ready).toHaveLength(1);
  });

  test('a rename onto a name taken after it was read is refused before publishing', async () => {
    const created = await createCustomSkill(input());
    const existing = await readRow(created.id);
    await createCustomSkill({ ...input(), name: 'Taken' });
    const calls = vi.mocked(anthropicSkills.createSkill).mock.calls.length;
    await expect(
      claimPublication(existing, { ...publication(), name: 'Taken' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(vi.mocked(anthropicSkills.createSkill).mock.calls.length).toBe(calls);
    expect((await readRow(created.id)).status).toBe('ready');
  });

  test('a rename Anthropic rejects restores the previous name and Anthropic skill', async () => {
    const created = await createCustomSkill(input());
    vi.mocked(anthropicSkills.createSkill).mockRejectedValueOnce(
      new APIError(400, undefined, 'Invalid', new Headers()),
    );
    await expect(
      updateCustomSkill({ ...input(), skillId: created.id, name: 'Bad' }),
    ).rejects.toThrow();
    expect(await readRow(created.id)).toMatchObject({
      status: 'ready',
      publication: null,
      name: 'Guide',
      anthropicSkillId: created.anthropicSkillId,
    });
  });

  test('a rejected rename keeps the new name when the old name was taken meanwhile', async () => {
    const created = await createCustomSkill(input());
    const claimed = await claimPublication(await readRow(created.id), {
      ...publication(),
      name: 'Renamed',
    });
    await createCustomSkill(input());
    const rejected = new APIError(400, undefined, 'Invalid rename', new Headers());
    vi.mocked(anthropicSkills.createSkill).mockRejectedValueOnce(rejected);
    await expect(finishPublication(claimed)).rejects.toBe(rejected);
    expect(await readRow(created.id)).toMatchObject({
      status: 'ready',
      name: 'Renamed',
      publication: null,
      anthropicSkillId: created.anthropicSkillId,
      latestVersion: created.latestVersion,
    });
    await expect(finishPublication(claimed)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('an abandoned rename cannot later be reported as published', async () => {
    const created = await createCustomSkill(input());
    const claimed = await claimPublication(await readRow(created.id), {
      ...publication(),
      name: 'Renamed',
    });
    vi.mocked(anthropicSkills.createSkill).mockRejectedValueOnce(
      new APIError(400, undefined, 'Invalid', new Headers()),
    );
    await expect(finishPublication(claimed)).rejects.toThrow();
    await expect(finishPublication(claimed)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await readRow(created.id)).name).toBe('Guide');
  });

  test('two servers updating presets at once both finish with every preset ready', async () => {
    await ensurePresetSkills();
    await db.update(skill).set({ sourceHash: 'outdated' }).where(eq(skill.kind, 'preset'));
    // Hold the first claim inside Postgres so both callers read the same ready revision.
    await db.execute(
      sql`create function delay_preset_claim() returns trigger language plpgsql as $$ begin if old.status = 'ready' and new.status = 'publishing' then perform pg_sleep(0.2); end if; return new; end $$`,
    );
    await db.execute(
      sql`create trigger delay_preset_claim before update on skill for each row execute function delay_preset_claim()`,
    );
    try {
      const outcomes = await Promise.allSettled([ensurePresetSkills(), ensurePresetSkills()]);
      expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    } finally {
      await db.execute(sql`drop trigger delay_preset_claim on skill`);
      await db.execute(sql`drop function delay_preset_claim()`);
    }
    const rows = await db.select().from(skill).where(eq(skill.kind, 'preset'));
    expect(rows.every((row) => row.status === 'ready' && row.sourceHash !== 'outdated')).toBe(true);
    expect(rows.every((row) => row.retainedSkillIds.length === 0)).toBe(true);
  });

  test.each([
    ['a preset', null, 'preset'],
    ['another workspace’s skill', 'other', 'custom'],
  ] as const)('deleting %s reads as not found and leaves it alone', async (_case, owner, kind) => {
    const ownerWorkspaceId = owner ? await seedWorkspace(owner) : null;
    const skillId = await seedSkill({
      workspaceId: ownerWorkspaceId,
      name: 'Theirs',
      kind,
      anthropicSkillId: 'remote_theirs',
    });
    await expect(deleteCustomSkill({ workspaceId, skillId })).rejects.toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
    });
    expect(anthropicSkills.deleteSkill).not.toHaveBeenCalled();
    expect(await skillRow(skillId)).toBeDefined();
  });

  test('a delete Anthropic fails keeps the skill out of new sessions and finishes on retry', async () => {
    const created = await createCustomSkill(input());
    vi.mocked(anthropicSkills.deleteSkill).mockRejectedValueOnce(
      new AppError('EXTERNAL_API_FAILED', 'Delete failed', {}),
    );
    await expect(deleteCustomSkill({ workspaceId, skillId: created.id })).rejects.toMatchObject({
      code: 'EXTERNAL_API_FAILED',
    });
    expect(await skillRow(created.id)).toBeDefined();
    expect(await listSessionSkillRefs({ workspaceId })).toEqual([]);
    await expect(updateCustomSkill({ ...input(), skillId: created.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await deleteCustomSkill({ workspaceId, skillId: created.id });
    expect(await skillRow(created.id)).toBeUndefined();
  });

  test('a delayed publication cannot recreate a skill that was deleted', async () => {
    const reserved = await reserve();
    if (!reserved) throw new Error('Missing reservation');
    const created = await finishPublication(reserved);
    await deleteCustomSkill({ workspaceId, skillId: created.id });
    vi.mocked(anthropicSkills.createSkill).mockClear();
    await expect(finishPublication(reserved)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(anthropicSkills.createSkill).not.toHaveBeenCalled();
  });

  test('deleting a skill mid-publication removes the Anthropic skill it already made', async () => {
    const reserved = await reserve();
    if (!reserved?.publication) throw new Error('Missing reservation');
    remote.set(`just-a-wrapper:${reserved.publication.token}`, { skillId: 'orphan', version: '1' });
    await deleteCustomSkill({ workspaceId, skillId: reserved.id });
    expect(anthropicSkills.createSkill).not.toHaveBeenCalled();
    expect(anthropicSkills.deleteSkill).toHaveBeenCalledWith('orphan');
    expect(await db.select().from(skill)).toEqual([]);
  });

  test('an Anthropic create that returns after the delete is removed again', async () => {
    const reserved = await reserve();
    if (!reserved) throw new Error('Missing reservation');
    vi.mocked(anthropicSkills.createSkill).mockImplementationOnce(async () => {
      await deleteCustomSkill({ workspaceId, skillId: reserved.id });
      return { skillId: 'late', version: '1' };
    });
    await expect(finishPublication(reserved)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(anthropicSkills.deleteSkill).toHaveBeenCalledWith('late');
  });

  test('a rejected version cannot undo a delete that started during its request', async () => {
    const created = await createCustomSkill(input());
    vi.mocked(anthropicSkills.deleteSkill).mockRejectedValueOnce(
      new AppError('EXTERNAL_API_FAILED', 'Retry deletion', {}),
    );
    vi.mocked(anthropicSkills.createVersion).mockImplementationOnce(async () => {
      await expect(deleteCustomSkill({ workspaceId, skillId: created.id })).rejects.toThrow();
      throw new APIError(400, undefined, 'Rejected', new Headers());
    });
    await expect(updateCustomSkill({ ...input(), skillId: created.id })).rejects.toThrow();
    expect((await readRow(created.id)).status).toBe('deleting');
  });

  test('a skill being deleted during a pending update lists its committed files', async () => {
    const created = await createCustomSkill(input());
    await claimPublication(await readRow(created.id), {
      ...publication(),
      files: [...files, { path: 'extra.md', content: 'Pending' }],
    });
    vi.mocked(anthropicSkills.deleteSkill).mockRejectedValueOnce(new Error('Retry deletion'));
    await expect(deleteCustomSkill({ workspaceId, skillId: created.id })).rejects.toThrow();
    expect(await listSkillsForWorkspace({ workspaceId })).toMatchObject([
      { status: 'deleting', fileCount: 1 },
    ]);
  });
});
