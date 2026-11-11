import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { file } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { AGENT_TIER_LIST } from '@/features/agents/config';
import { accrueTitleGeneration } from '@/features/billing/api/accrue-title-generation';
import { signedBlobUrl } from '@/features/files/api/blob-storage';
import { fileVisibleTo } from '@/features/files/lib/team-folder';
import { publishSessionEvent } from '@/features/realtime/server';
import { runAfterResponse } from '@/features/sessions/api/create-background-work';
import { storeGeneratedTitleTransition } from '@/features/sessions/api/title-transitions';
import { stripAttachedFiles } from '@/features/sessions/lib/strip-attached-files';
import {
  buildTitleUserContent,
  TITLE_MAX_CHARS,
  TITLE_MODEL,
  TITLE_SYSTEM,
} from '@/features/sessions/lib/title-prompt';
import { UNTITLED_SESSION_TITLE } from '@/features/sessions/lib/untitled-session-title';
import { AppError } from '@/lib/errors';
import { parseFileContentUrl } from '@/lib/file-content-url';

// Generate titles in background work so failures cannot fail session creation.
// Keep the stored neutral title on error. Publish successful changes on the session
// privacy channel so sidebar titles update without reload.

/** Pure: clamp + clean a model-produced title; empty result = unusable. */
function cleanGeneratedTitle(raw: string): string {
  const oneLine = raw
    .slice(0, raw.includes('\n') ? raw.indexOf('\n') : raw.length)
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > TITLE_MAX_CHARS ? `${oneLine.slice(0, TITLE_MAX_CHARS)}…` : oneLine;
}

async function generateAndStoreTitle(input: {
  anthropicSessionId: string;
  workspaceId: string;
  organizationId: string;
  message: string;
  userId: string;
}): Promise<void> {
  const client = getAnthropicClient();
  // No key → the neutral title stays; nothing to do.
  if (!client) return;

  const attachments = await titleAttachments(input);
  const response = await client.messages.create({
    model: TITLE_MODEL,
    max_tokens: 64,
    // Haiku 5.5 thinks by default, and thinking would spend this short output cap.
    thinking: { type: 'disabled' },
    system: TITLE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: buildTitleUserContent(input.message, attachments),
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ');
  const title = cleanGeneratedTitle(text);
  // An unusable output keeps the neutral title; the call is still recorded.
  if (title) await storeGeneratedTitle(input, title);

  await accrueTitleGeneration({
    anthropicSessionId: input.anthropicSessionId,
    responseId: response.id,
    pricingTier: titlePricingTier(),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  });
}

// The title model is priced at the tier that runs the same model.
function titlePricingTier() {
  const tier = AGENT_TIER_LIST.find((config) => config.model === TITLE_MODEL)?.tier;
  if (!tier)
    throw new AppError('UNEXPECTED', 'The title model has no tier price', { model: TITLE_MODEL });
  return tier;
}

// Title generation runs after the response. Failure leaves the stored neutral title and cannot
// undo session creation.
export function scheduleSessionTitleGeneration(input: {
  anthropicSessionId: string;
  workspaceId: string;
  organizationId: string;
  message: string;
  userId: string;
}): void {
  runAfterResponse('session-title-generate', { sessionId: input.anthropicSessionId }, () =>
    generateAndStoreTitle(input),
  );
}

async function titleAttachments(input: { message: string; workspaceId: string; userId: string }) {
  const urls = stripAttachedFiles(input.message).entries.flatMap((entry) =>
    entry.kind === 'file' && entry.url ? [entry.url] : [],
  );
  const ids = urls.flatMap((url) => {
    const parsed = parseFileContentUrl(url);
    return parsed ? [parsed.fileId] : [];
  });
  // Resolve only stored, visible files. Never forward an arbitrary user URL to
  // the vision model; the message determines order, not file authorization.
  const files = urls.length
    ? await db
        .select({
          name: file.filename,
          storagePath: file.storagePath,
          mimeType: file.mimeType,
          id: file.id,
        })
        .from(file)
        .where(
          and(
            eq(file.workspaceId, input.workspaceId),
            fileVisibleTo(input.userId),
            isNull(file.deletedAt),
            inArray(file.id, ids),
          ),
        )
    : [];
  return Promise.all(
    ids
      .flatMap((id) => files.filter((file) => file.id === id))
      .map(async (file) => ({ ...file, url: await signedBlobUrl(file.storagePath) })),
  );
}

async function storeGeneratedTitle(
  input: Parameters<typeof generateAndStoreTitle>[0],
  title: string,
): Promise<void> {
  const row = await storeGeneratedTitleTransition(
    input.anthropicSessionId,
    input.workspaceId,
    title,
  );
  if (!row) return;

  // Publish generated titles by local UUID, on the creator channel for private tasks, so sidebar
  // updates cannot leak across members.
  await publishSessionEvent(
    { type: 'session_title', sessionId: row.id, title, previousTitle: UNTITLED_SESSION_TITLE },
    {
      organizationId: input.organizationId,
      session: { visibility: row.visibility, createdByUserId: row.createdByUserId },
    },
  );
}
