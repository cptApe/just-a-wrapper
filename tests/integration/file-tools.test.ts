// Agent tools that take or make files: which file a name resolves to, and the Library read, save and search tools.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DownloadedSessionOutput } from '@/features/tools/api/session-output';

const state = vi.hoisted(() => ({
  // How Blob serves a stored file: fixed bytes, or through fetch so a test sees the request.
  blobThroughFetch: false,
  // A stand-in session-output lookup that finds nothing by default; null runs the real one.
  sessionOutput: null as null | ((input: unknown) => Promise<unknown>),
}));
vi.mock('@vercel/blob', () => ({
  issueSignedToken: async () => ({}),
  presignUrl: async (_token: unknown, { pathname }: { pathname: string }) => ({
    presignedUrl: `https://files.example/${pathname}`,
  }),
  get: async (pathname: string) => ({
    statusCode: 200,
    stream: state.blobThroughFetch
      ? (
          await fetch(`https://blob.test/${pathname}`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(60000),
          })
        ).body
      : new Response(new Uint8Array([1, 2, 3])).body,
  }),
}));
const { importDriveFile, generateGatewayImage, transcribeAudio, download, upload, addResource } =
  vi.hoisted(() => ({
    importDriveFile: vi.fn(),
    generateGatewayImage: vi.fn(),
    transcribeAudio: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
    addResource: vi.fn(),
  }));
vi.mock('@/features/files/api/import-drive-file', () => ({ importDriveFile }));
vi.mock('@/features/tools/lib/gateway-image', () => ({ generateGatewayImage }));
vi.mock('@/features/voice/server', () => ({ synthesizeSpeech: vi.fn(), transcribeAudio }));
const downloadSessionOutput = vi.hoisted(() => vi.fn());
vi.mock('@/features/tools/api/session-output', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/tools/api/session-output')>();
  downloadSessionOutput.mockImplementation(
    (input: Parameters<typeof actual.downloadSessionOutput>[0]) =>
      state.sessionOutput ? state.sessionOutput(input) : actual.downloadSessionOutput(input),
  );
  return { ...actual, downloadSessionOutput };
});
vi.mock('@/features/agents', () => {
  const client = {
    beta: {
      // The real artifact sweep lists the session's outputs; these sessions have none.
      files: { download, upload, list: async function* () {} },
      sessions: { resources: { add: addResource } },
    },
  };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});
// The real URL guard runs; only its DNS answer is fixed to a public address.
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));
// Set before any app module loads, since configuration is read at import.
vi.hoisted(() => {
  vi.stubEnv('AI_GATEWAY_API_KEY', 'gateway_test');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_teststore_testsecret');
});

import { EditImageInputSchema } from '@/features/tool-catalog/edit-image';
import { GenerateImageInputSchema } from '@/features/tool-catalog/generate-image';
import { TranscribeAudioInputSchema } from '@/features/tool-catalog/voice';
import { resolveToolFile } from '@/features/tools/api/file-resolver';
import { editImageTool } from '@/features/tools/custom-tools/edit-image';
import { generateImageTool } from '@/features/tools/custom-tools/generate-image';
import {
  readLibraryFileTool,
  saveToLibraryTool,
  searchLibraryTool,
} from '@/features/tools/custom-tools/library-verbs';
import { transcribeAudioTool } from '@/features/tools/custom-tools/voice';
import { requiredEntry } from '../support/required-entry';
import { seedCreditBalance } from './helpers/billing-ledger';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const testDb = makeTestDb(pool);
type Ctx = Awaited<ReturnType<typeof seedContext>>;
let ctx: Ctx;
const READ_LIMIT = 25 * 1024 * 1024;

beforeAll(async () => applyMigrations(testDb));
afterAll(async () => pool.end());
beforeEach(async () => {
  await truncateAll(testDb);
  for (const fn of [importDriveFile, generateGatewayImage, transcribeAudio, download, upload]) {
    fn.mockReset();
  }
  addResource.mockReset();
  downloadSessionOutput.mockClear();
  state.blobThroughFetch = false;
  state.sessionOutput = async () => null;
  vi.unstubAllGlobals();
  ctx = await seedContext();
});

async function seedContext() {
  await seedUser(testDb, 'file_user');
  await seedOrganization(testDb, 'file_org');
  const { id: workspaceId } = requiredEntry(
    (
      await testDb.execute<{ id: string }>(
        sql`insert into workspace (organization_id, name) values ('file_org', 'Files') returning id`,
      )
    ).rows,
    0,
  );
  const { id: sessionRowId } = requiredEntry(
    (
      await testDb.execute<{ id: string }>(sql`
      insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, anthropic_session_id, permission_mode)
      values ('read_write', ${workspaceId}, 'default', 'file_user', 'chat', 'session_files', 'ask') returning id
    `)
    ).rows,
    0,
  );
  await testDb.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('file-owner', 'file_org', 'file_user', 'owner', now())`,
  );
  await seedCreditBalance(testDb, workspaceId, 1000);
  return { workspaceId, userId: 'file_user', sessionId: 'session_files', sessionRowId };
}

/** A Library file row; `session` links it to this chat as an attachment or tool output. */
async function seedFile(input: {
  folderPath: string;
  filename: string;
  source?: 'user_upload' | 'agent_generated' | 'session_output';
  mimeType?: string;
  sizeBytes?: number;
  session?: boolean;
  id?: string;
  storagePath?: string;
  deleted?: boolean;
  createdByUserId?: string;
}) {
  const folder = input.folderPath === '/' ? '' : input.folderPath;
  await testDb.execute(sql`
    insert into file (id, workspace_id, created_by_user_id, source, session_id, storage_path, folder_path, filename, mime_type, size_bytes, deleted_at)
    values (coalesce(${input.id ?? null}::uuid, gen_random_uuid()), ${ctx.workspaceId}, ${input.createdByUserId ?? ctx.userId},
      ${input.source ?? 'user_upload'}, ${input.session ? ctx.sessionRowId : null},
      ${input.storagePath ?? `ws/${ctx.workspaceId}${folder}/${input.filename}`}, ${input.folderPath},
      ${input.filename}, ${input.mimeType ?? 'text/plain'}, ${input.sizeBytes ?? 3},
      ${input.deleted ? new Date() : null})
  `);
}

function output(fields: Partial<DownloadedSessionOutput> = {}): DownloadedSessionOutput {
  return {
    artifactId: 'artifact-output',
    filename: 'report.txt',
    mimeType: 'text/plain',
    sizeBytes: 3,
    savedDriveFileId: null,
    response: new Response('out'),
    ...fields,
  };
}

describe('finding the file a tool names', () => {
  test('a name resolves from the Library, then attachments, outputs, tool outputs, then a sweep', async () => {
    const lookups: Array<{ sweepOnMiss: boolean }> = [];
    let sweptOutput: DownloadedSessionOutput | null = output();
    state.sessionOutput = async (input) => {
      const { sweepOnMiss } = input as { sweepOnMiss: boolean };
      lookups.push({ sweepOnMiss });
      return sweptOutput;
    };
    const fileId = '00000000-0000-4000-8000-000000000098';
    await seedFile({ id: fileId, folderPath: '/', filename: 'report.txt', session: true });
    expect((await resolveToolFile({ name: 'report.txt' }, ctx)).foundIn).toBe('library');
    expect((await resolveToolFile({ name: '/mnt/session/uploads/report.txt' }, ctx)).foundIn).toBe(
      'chat_attachment',
    );
    expect(lookups).toEqual([]);
    await testDb.execute(sql`delete from file where id = ${fileId}`);
    expect((await resolveToolFile({ name: 'report.txt' }, ctx)).foundIn).toBe('session_output');
    expect(lookups.at(-1)).toEqual({ sweepOnMiss: false });
    await seedFile({
      id: fileId,
      folderPath: '/Generated',
      filename: 'report.txt',
      source: 'agent_generated',
      session: true,
    });
    sweptOutput = null;
    expect((await resolveToolFile({ name: 'latest document' }, ctx)).foundIn).toBe('tool_output');
    await testDb.execute(sql`delete from file where id = ${fileId}`);
    state.sessionOutput = async (input) =>
      (input as { sweepOnMiss: boolean }).sweepOnMiss
        ? output({ artifactId: 'swept-output' })
        : null;
    expect((await resolveToolFile({ name: 'report.txt' }, ctx)).sessionArtifactId).toBe(
      'swept-output',
    );
  });

  test('in a shared chat a teammate reaches only Team files, never the creator’s private ones', async () => {
    await seedUser(testDb, 'file_viewer');
    await seedFile({ folderPath: '/Chat uploads', filename: 'private.mp3', session: true });
    await seedFile({ folderPath: '/Team', filename: 'shared.mp3', session: true });
    await seedFile({
      folderPath: '/Generated images',
      filename: 'private-tool.png',
      source: 'agent_generated',
      session: true,
    });
    await seedFile({
      folderPath: '/Team',
      filename: 'shared-tool.png',
      source: 'agent_generated',
      session: true,
    });
    const viewer = { ...ctx, userId: 'file_viewer' };
    for (const name of ['private.mp3', 'private-tool.png']) {
      await expect(resolveToolFile({ name }, viewer)).rejects.toMatchObject({
        code: 'TOOL_INPUT_INVALID',
      });
    }
    await expect(resolveToolFile({ name: 'shared.mp3' }, viewer)).resolves.toMatchObject({
      foundIn: 'chat_attachment',
      libraryPath: '/Team/shared.mp3',
    });
    await expect(resolveToolFile({ name: 'shared-tool.png' }, viewer)).resolves.toMatchObject({
      foundIn: 'tool_output',
      libraryPath: '/Team/shared-tool.png',
    });
  });

  test('a file id link to a private file opens only for its creator, without any fetch', async () => {
    await seedUser(testDb, 'other-viewer');
    const fileId = '00000000-0000-4000-8000-000000000099';
    await seedFile({ id: fileId, folderPath: '/', filename: 'private.txt' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const reference = { url: `/api/files/${fileId}/content` };
    expect((await resolveToolFile(reference, ctx)).id).toBe(fileId);
    await expect(
      resolveToolFile(reference, { ...ctx, userId: 'other-viewer' }),
    ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(downloadSessionOutput).not.toHaveBeenCalled();
  });

  test('a trashed Library file is not found', async () => {
    await seedFile({
      folderPath: '/Generated images',
      filename: 'trashed.png',
      source: 'agent_generated',
      session: true,
      deleted: true,
    });
    await expect(resolveToolFile({ name: 'trashed.png' }, ctx)).rejects.toMatchObject({
      code: 'TOOL_INPUT_INVALID',
    });
  });

  test('two attachments with the same name are refused instead of guessing the newest', async () => {
    for (const suffix of ['a', 'b']) {
      await seedFile({
        folderPath: '/Chat uploads',
        filename: 'duplicate.png',
        storagePath: `ws/${ctx.workspaceId}/${suffix}`,
        session: true,
      });
    }
    await expect(resolveToolFile({ name: 'duplicate.png' }, ctx)).rejects.toMatchObject({
      code: 'TOOL_INPUT_INVALID',
    });
  });

  test('a session output over the read limit is refused before its body is read', async () => {
    const lookups: unknown[] = [];
    state.sessionOutput = async (input) => {
      lookups.push(input);
      return output({ filename: 'huge.wav', sizeBytes: READ_LIMIT + 1 });
    };
    await expect(resolveToolFile({ outputFilename: 'huge.wav' }, ctx)).rejects.toMatchObject({
      code: 'TOOL_INPUT_INVALID',
    });
    expect(lookups).toEqual([
      expect.objectContaining({ maxBytes: READ_LIMIT, sweepOnMiss: false }),
    ]);
  });
});

describe('media tools reuse files by name', () => {
  test('edit_image finds the image generate_image just made in this chat', async () => {
    const generatedFile = {
      id: '00000000-0000-4000-8000-000000000010',
      filename: 'city-at-night-a1b2c3.png',
      folderPath: '/Generated images',
      mimeType: 'image/png',
      sizeBytes: 3,
      url: 'https://files.example/test/raw/generated.png',
      source: 'agent_generated' as const,
      createdAt: '2026-09-03T12:00:00.000Z',
    };
    const editedFile = {
      ...generatedFile,
      id: '00000000-0000-4000-8000-000000000002',
      filename: 'make-it-warmer-d4e5f6.png',
    };
    importDriveFile.mockResolvedValueOnce(generatedFile).mockResolvedValueOnce(editedFile);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ images: [{ url: 'https://provider.example/generated.png' }] }),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
        .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]))),
    );
    generateGatewayImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      generationId: 'gen_test',
      model: 'openai/gpt-image-2',
    });
    const generated = await generateImageTool.handler(
      GenerateImageInputSchema.parse({ prompt: 'City at night' }),
      ctx,
    );
    await seedFile({
      id: generatedFile.id,
      folderPath: generatedFile.folderPath,
      filename: generatedFile.filename,
      source: 'agent_generated',
      mimeType: 'image/png',
      session: true,
    });
    const edited = await editImageTool.handler(
      EditImageInputSchema.parse({
        operation: 'edit',
        prompt: 'Make it warmer',
        sources: [{ name: generated.image.filename }],
      }),
      ctx,
    );
    expect(generateGatewayImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'gateway' }),
      expect.objectContaining({ images: [expect.stringMatching(/^https:\/\/files.example\//)] }),
    );
    expect(edited.image.filename).toBe(editedFile.filename);
  });

  test('transcribe_audio finds a chat attachment by the name the person sees', async () => {
    await seedFile({
      folderPath: '/Chat uploads',
      filename: 'memo.mp3',
      mimeType: 'audio/mpeg',
      session: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg', 'content-length': '3' },
        }),
      ),
    );
    transcribeAudio.mockResolvedValue({
      text: 'Call Tomas tomorrow.',
      audioSeconds: 4,
      language: 'en',
    });
    const result = await transcribeAudioTool.handler(
      TranscribeAudioInputSchema.parse({ source: { name: 'memo.mp3' } }),
      ctx,
    );
    expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ kind: 'gateway' }), {
      file: expect.objectContaining({ name: 'memo.mp3', type: 'audio/mpeg' }),
    });
    expect(result.text).toBe('Call Tomas tomorrow.');
  });

  test.each([
    ['imports a session output once across two edits', false],
    ['never reuses a teammate’s private saved copy', true],
  ])('edit_image %s', async (_case, teammateSaved) => {
    const { id: artifactId } = requiredEntry(
      (
        await testDb.execute<{ id: string }>(sql`
        insert into artifact (workspace_id, session_id, anthropic_file_id, filename, mime_type, size_bytes, downloadable, file_created_at)
        values (${ctx.workspaceId}, ${ctx.sessionRowId}, 'anthropic_draft', 'draft.png', 'image/png', 3, true, now())
        returning id
      `)
      ).rows,
      0,
    );
    const savedSource = {
      id: '00000000-0000-4000-8000-000000000040',
      filename: 'draft.png',
      folderPath: '/Generated images',
      mimeType: 'image/png',
      sizeBytes: 3,
      url: '/api/files/00000000-0000-4000-8000-000000000040/content',
      source: 'session_output' as const,
      createdAt: new Date().toISOString(),
    };
    const teammateCopy = '00000000-0000-4000-8000-000000000099';
    if (teammateSaved) {
      await seedUser(testDb, 'other');
      await seedFile({
        id: teammateCopy,
        folderPath: '/Artifacts',
        filename: 'draft.png',
        source: 'session_output',
        storagePath: `ws/${ctx.workspaceId}/private.png`,
        createdByUserId: 'other',
      });
      await testDb.execute(
        sql`insert into artifact_save (artifact_id, user_id, file_id) values (${artifactId}, 'other', ${teammateCopy})`,
      );
    }
    let editedIndex = 0;
    importDriveFile.mockImplementation(async (input) => {
      if (input.source === 'session_output' && input.filename === 'draft.png') {
        await seedFile({
          id: savedSource.id,
          folderPath: savedSource.folderPath,
          filename: 'draft.png',
          source: 'session_output',
          mimeType: 'image/png',
          session: true,
        });
        return savedSource;
      }
      editedIndex += 1;
      return { ...savedSource, id: `edited_${editedIndex}`, filename: `edited-${editedIndex}.png` };
    });
    // The viewer's own save, the way the real lookup resolves it.
    state.sessionOutput = async () => {
      const row = (
        await testDb.execute<{ savedDriveFileId: string }>(sql`
          select file_id as "savedDriveFileId" from artifact_save
          where artifact_id = ${artifactId} and user_id = ${ctx.userId}
        `)
      ).rows.at(0);
      return output({
        artifactId,
        filename: 'draft.png',
        mimeType: 'image/png',
        savedDriveFileId: row?.savedDriveFileId ?? null,
        response: new Response(new Uint8Array([1, 2, 3])),
      });
    };
    generateGatewayImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      generationId: 'gen_test',
      model: 'openai/gpt-image-2',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(new Uint8Array([4, 5, 6]))),
    );
    const input = EditImageInputSchema.parse({
      operation: 'edit',
      prompt: 'Polish it',
      sources: [{ output_filename: 'draft.png' }],
    });
    await editImageTool.handler(input, ctx);
    if (!teammateSaved) await editImageTool.handler(input, ctx);
    const sourceImports = importDriveFile.mock.calls.filter(
      ([call]) => call.source === 'session_output' && call.filename === 'draft.png',
    );
    expect(sourceImports).toHaveLength(1);
    for (const call of generateGatewayImage.mock.calls) {
      expect(call[1].images).toEqual([
        `https://files.example/ws/${ctx.workspaceId}/Generated images/draft.png`,
      ]);
    }
    const saves = await testDb.execute<{ userId: string; fileId: string }>(sql`
      select user_id as "userId", file_id as "fileId" from artifact_save
      where artifact_id = ${artifactId} order by user_id
    `);
    expect(saves.rows).toEqual([
      { userId: ctx.userId, fileId: savedSource.id },
      ...(teammateSaved ? [{ userId: 'other', fileId: teammateCopy }] : []),
    ]);
  });
});

describe('read_library_file', () => {
  beforeEach(() => {
    state.blobThroughFetch = true;
    upload.mockResolvedValue({ id: 'file_uploaded' });
    addResource.mockResolvedValue({ id: 'resource_1' });
  });

  test('long text comes back inline, marked truncated, read from our own store without redirects', async () => {
    await seedFile({ folderPath: '/', filename: 'notes.txt', sizeBytes: 10001 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('a'.repeat(10001), {
          headers: { 'content-type': 'application/octet-stream' },
        }),
      ),
    );
    const result = await readLibraryFileTool.handler({ path: '/notes.txt' }, ctx);
    expect(result).toMatchObject({ delivery: 'inline', truncated: true });
    expect(result.text?.endsWith('…')).toBe(true);
    const [requestedUrl, requestInit] = requiredEntry(vi.mocked(fetch).mock.calls, 0);
    expect(requestedUrl.toString()).toBe(`https://blob.test/ws/${ctx.workspaceId}/notes.txt`);
    expect(requestInit).toEqual(expect.objectContaining({ redirect: 'manual' }));
  });

  test('a binary file is uploaded and mounted into this chat', async () => {
    await seedFile({ folderPath: '/', filename: 'report.pdf', mimeType: 'application/pdf' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));
    expect(await readLibraryFileTool.handler({ path: '/report.pdf' }, ctx)).toEqual({
      path: '/report.pdf',
      delivery: 'mounted',
      mountedPath: '/mnt/session/uploads/report.pdf',
    });
    expect(addResource).toHaveBeenCalledWith(
      ctx.sessionId,
      expect.objectContaining({
        type: 'file',
        file_id: 'file_uploaded',
        mount_path: '/report.pdf',
      }),
    );
  });

  test('a second Library file with the same name mounts under a numbered name', async () => {
    await seedFile({ folderPath: '/A', filename: 'report.pdf', mimeType: 'application/pdf' });
    await seedFile({ folderPath: '/B', filename: 'report.pdf', mimeType: 'application/pdf' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))));
    await expect(
      readLibraryFileTool.handler({ path: '/B/report.pdf' }, ctx),
    ).resolves.toMatchObject({
      mountedPath: '/mnt/session/uploads/report (2).pdf',
    });
  });

  test.each([
    ['stored under another workspace', 'ws/other/secret.txt', 12],
    ['over 25 MB', undefined, READ_LIMIT + 1],
  ])('a file %s is refused without reading it', async (_case, storagePath, sizeBytes) => {
    await seedFile({ folderPath: '/', filename: 'secret.txt', storagePath, sizeBytes });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(readLibraryFileTool.handler({ path: '/secret.txt' }, ctx)).resolves.toMatchObject({
      delivery: 'missing',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a web file whose response is over the read limit is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array(), { headers: { 'content-length': String(READ_LIMIT + 1) } }),
        ),
    );
    await expect(
      readLibraryFileTool.handler({ path: 'https://files.example/acct/raw/large.bin' }, ctx),
    ).resolves.toMatchObject({ delivery: 'missing' });
  });
});

describe('save_to_library and search_library', () => {
  beforeEach(() => {
    state.sessionOutput = null;
  });
  const saved = (fields: Record<string, unknown>) => ({
    id: 'file_saved',
    sizeBytes: 3,
    createdAt: new Date().toISOString(),
    ...fields,
  });

  test('text the agent writes is saved as UTF-8 with its file type, into a new folder', async () => {
    importDriveFile.mockResolvedValue(
      saved({
        filename: 'plan.md',
        folderPath: '/Notes/2026',
        mimeType: 'text/markdown',
        url: 'https://cdn.example/plan.md',
        source: 'agent_generated',
      }),
    );
    const result = await saveToLibraryTool.handler(
      { content: 'Plan', folder_path: '/Notes/2026', filename: 'plan.md' },
      ctx,
    );
    expect(result).toEqual({ path: '/Notes/2026/plan.md', url: 'https://cdn.example/plan.md' });
    const call = requiredEntry(requiredEntry(importDriveFile.mock.calls, 0), 0);
    expect(call).toMatchObject({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      filename: 'plan.md',
      mimeType: 'text/markdown',
      folderPath: '/Notes/2026',
      source: 'agent_generated',
      sessionId: ctx.sessionRowId,
    });
    expect(new TextDecoder().decode(call.bytes)).toBe('Plan');
  });

  test('a session output is downloaded from Anthropic and saved under a new name', async () => {
    await testDb.execute(sql`
      insert into artifact (workspace_id, session_id, anthropic_file_id, filename, mime_type, size_bytes, downloadable, file_created_at)
      values (${ctx.workspaceId}, ${ctx.sessionRowId}, 'file_anthropic', 'report.pdf', 'application/pdf', 3, true, now())
    `);
    download.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    importDriveFile.mockResolvedValue(
      saved({
        filename: 'final.pdf',
        folderPath: '/Reports',
        mimeType: 'application/pdf',
        url: 'https://cdn.example/final.pdf',
        source: 'session_output',
      }),
    );
    const result = await saveToLibraryTool.handler(
      { output_filename: 'report.pdf', folder_path: '/Reports', filename: 'final.pdf' },
      ctx,
    );
    expect(download).toHaveBeenCalledWith('file_anthropic', expect.anything(), expect.anything());
    expect(importDriveFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'final.pdf',
        folderPath: '/Reports',
        sessionId: ctx.sessionRowId,
      }),
    );
    expect(result.path).toBe('/Reports/final.pdf');
  });

  test('saving a missing output creates no empty folders', async () => {
    await expect(
      saveToLibraryTool.handler(
        { output_filename: 'missing.pdf', folder_path: ' /Reports//2026/ ' },
        ctx,
      ),
    ).resolves.toMatchObject({
      path: '/Reports/2026',
      message: expect.stringContaining('missing.pdf'),
    });
    const folders = await testDb.execute<{ count: number }>(
      sql`select count(*)::int as count from folder`,
    );
    expect(requiredEntry(folders.rows, 0).count).toBe(0);
    expect(importDriveFile).not.toHaveBeenCalled();
  });

  test('search_library hides storage URLs and says when results were cut off', async () => {
    for (let index = 0; index < 61; index += 1) {
      await seedFile({ folderPath: '/', filename: `match-${index}.txt`, sizeBytes: 12 });
    }
    const result = await searchLibraryTool.handler({ query: 'match-' }, ctx);
    expect(result.results).toHaveLength(60);
    expect(result.truncated).toBe(true);
    expect(requiredEntry(result.results, 0)).not.toHaveProperty('url');
  });
});
