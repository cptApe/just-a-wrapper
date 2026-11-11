import 'server-only';
import { and, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { file, folder, integration, skill, task as taskTable } from '@/db/schema';
import { fileVisibleTo, folderVisibleTo } from '@/features/files/lib/team-folder';
// Pure hash builder (no React, no browser APIs) — the sanctioned way to write
// overlay deep links; never hand-roll hash strings.
import { buildOverlayHash } from '@/features/overlays/lib/hash';
import { publicSessionStatus } from '@/features/sessions/lib/session-machine';
import { PRESET_SKILLS } from '@/features/skills/constants';
import { taskVisibleToViewer } from '@/features/tasks/api/task-visibility';
import { ENABLED_TOOLKITS, toolkitLogoUrl } from '@/lib/composio/toolkits';
import { captureException } from '@/lib/observability';
import { SEARCH_RESULTS_PER_GROUP } from '../constants';
import { escapeLike, normalizeQuery } from '../lib/match';
import { taskStatusSubtitle } from '../lib/task-results';
import type { ServerSearchResult } from '../types';
import { queryTaskMatches } from './query-task-matches';
import { searchMemoryNotes } from './search-memory';

export type WorkspaceSearchInput = {
  workspaceId: string;
  userId: string;
  /** Raw query; normalized here. */
  query: string;
  /** Request headers — the memory domain re-resolves its stores from the session. */
  headers: Headers;
};

// Scope every domain on the server; never trust client-supplied store handles or search across tenants.
export async function searchWorkspace(input: WorkspaceSearchInput): Promise<ServerSearchResult[]> {
  const query = normalizeQuery(input.query);
  if (query === '') return [];

  const contains = `%${escapeLike(query)}%`;
  const prefix = `${escapeLike(query)}%`;

  const domains: Array<{ name: string; run: () => Promise<ServerSearchResult[]> }> = [
    {
      name: 'task',
      run: () => searchTasks(input.workspaceId, input.userId, contains, prefix),
    },
    {
      name: 'library',
      run: () => searchLibrary(input.workspaceId, input.userId, contains, prefix),
    },
    {
      name: 'memory',
      run: () =>
        searchMemoryNotes({ headers: input.headers, query, limit: SEARCH_RESULTS_PER_GROUP }),
    },
    { name: 'app', run: () => searchApps(input.workspaceId, input.userId, query) },
    { name: 'skill', run: () => searchSkills(input.workspaceId, contains, prefix) },
    {
      name: 'scheduled',
      run: () => searchScheduled(input.workspaceId, input.userId, contains, prefix),
    },
  ];

  // Search keeps healthy domains visible when an independent source fails.
  const settled = await Promise.all(
    domains.map(async (domain) => ({
      domain,
      outcome: (await Promise.allSettled([domain.run()] as const))[0],
    })),
  );
  const results: ServerSearchResult[] = [];
  settled.forEach(({ domain, outcome }) => {
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
      return;
    }
    captureException(outcome.reason, { feature: 'search', domain: domain.name });
  });
  return results;
}

/** ORDER BY helper: prefix matches rank above substring matches. */
function prefixFirst(column: AnyPgColumn, prefix: string) {
  return sql`case when ${column} ilike ${prefix} then 0 else 1 end`;
}

// Tasks — the sidebar's own visibility contract (chat kind, relayed, not
// soft-deleted), matched on title or the bounded persisted message corpus.
async function searchTasks(
  workspaceId: string,
  viewerId: string,
  contains: string,
  prefix: string,
): Promise<ServerSearchResult[]> {
  const rows = await queryTaskMatches({
    workspaceId,
    contains,
    prefix,
    limit: SEARCH_RESULTS_PER_GROUP,
    viewerId,
  });

  return rows.map((row) => ({
    group: 'task' as const,
    id: row.id,
    title: row.title ?? 'Untitled task',
    subtitle: row.titleMatches
      ? taskStatusSubtitle(publicSessionStatus(row.status))
      : 'Message match',
    href: `/app/task/${row.id}`,
  }));
}

// Library — files (uploads, notes, agent outputs) by filename plus folders by
// name. Files open in the shared preview canvas over the Library at their
// folder; folders open the Library at their path.
async function searchLibrary(
  workspaceId: string,
  viewerId: string,
  contains: string,
  prefix: string,
): Promise<ServerSearchResult[]> {
  const [fileRows, folderRows] = await Promise.all([
    db
      .select({ id: file.id, filename: file.filename, folderPath: file.folderPath })
      .from(file)
      .where(
        and(
          eq(file.workspaceId, workspaceId),
          isNull(file.deletedAt),
          ilike(file.filename, contains),
          fileVisibleTo(viewerId),
        ),
      )
      .orderBy(prefixFirst(file.filename, prefix), desc(file.createdAt))
      .limit(SEARCH_RESULTS_PER_GROUP),
    db
      .select({ id: folder.id, path: folder.path })
      .from(folder)
      .where(
        and(
          eq(folder.workspaceId, workspaceId),
          isNull(folder.deletedAt),
          ilike(folder.path, contains),
          folderVisibleTo(viewerId),
        ),
      )
      .orderBy(folder.path)
      .limit(3),
  ]);

  const files = fileRows.map((row) => {
    const inFolder = row.folderPath === '/' ? '' : `?path=${encodeURIComponent(row.folderPath)}`;
    return {
      group: 'library' as const,
      id: row.id,
      title: row.filename,
      subtitle: row.folderPath === '/' ? 'Library' : `Library ${row.folderPath}`,
      href: `/app/library${inFolder}#${buildOverlayHash('file', row.id)}`,
    };
  });

  const folders = folderRows.map((row) => ({
    group: 'library' as const,
    id: row.id,
    title: row.path.slice(row.path.lastIndexOf('/') + 1),
    subtitle: 'Folder',
    href: `/app/library?path=${encodeURIComponent(row.path)}`,
  }));

  return [...files, ...folders];
}

// Apps — the curated catalog (static config) matched on name/slug/tags, with
// the caller's live connections marked. Opens the app detail overlay on Tools.
async function searchApps(
  workspaceId: string,
  userId: string,
  query: string,
): Promise<ServerSearchResult[]> {
  const q = query.toLowerCase();
  const matched = ENABLED_TOOLKITS.filter(
    (toolkit) =>
      toolkit.name.toLowerCase().includes(q) ||
      toolkit.slug.includes(q) ||
      toolkit.tags.some((tag) => tag.includes(q)),
  );
  if (matched.length === 0) return [];

  const connections = await db
    .select({ toolkit: integration.toolkit })
    .from(integration)
    .where(
      and(
        eq(integration.workspaceId, workspaceId),
        eq(integration.userId, userId),
        eq(integration.status, 'connected'),
      ),
    );
  const connected = new Set(connections.map((c) => c.toolkit));

  return matched
    .sort((a, b) => {
      const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      const aConnected = connected.has(a.slug) ? 0 : 1;
      const bConnected = connected.has(b.slug) ? 0 : 1;
      return aConnected - bConnected;
    })
    .slice(0, SEARCH_RESULTS_PER_GROUP)
    .map((toolkit) => ({
      group: 'app' as const,
      id: toolkit.slug,
      title: toolkit.name,
      subtitle: connected.has(toolkit.slug) ? 'Connected' : undefined,
      href: `/app/tools#${buildOverlayHash('app', toolkit.slug)}`,
      // Use the same public, credential-free logo URL as the tools grid and app overlay.
      logoUrl: toolkitLogoUrl(toolkit.slug),
    }));
}

// Skills — presets (global) + this workspace's customs, matched on name or
// description. Opens the skill inspector overlay on Tools.
async function searchSkills(
  workspaceId: string,
  contains: string,
  prefix: string,
): Promise<ServerSearchResult[]> {
  const rows = await db
    .select({ id: skill.id, name: skill.name, description: skill.description, kind: skill.kind })
    .from(skill)
    .where(
      and(
        or(eq(skill.ownerWorkspaceId, workspaceId), isNull(skill.ownerWorkspaceId)),
        or(
          ne(skill.kind, 'preset'),
          inArray(
            skill.name,
            PRESET_SKILLS.map((preset) => preset.name),
          ),
        ),
        or(ilike(skill.name, contains), ilike(skill.description, contains)),
      ),
    )
    .orderBy(prefixFirst(skill.name, prefix), desc(skill.updatedAt))
    .limit(SEARCH_RESULTS_PER_GROUP);

  return rows.map((row) => ({
    group: 'skill' as const,
    id: row.id,
    title: row.name,
    subtitle: row.description,
    href: `/app/tools?tab=skills#${buildOverlayHash('skill', row.id)}`,
  }));
}

// Scheduled — standing task definitions (active, paused, or mid-run), matched
// on title or description. The /scheduled page is where they are managed.
async function searchScheduled(
  workspaceId: string,
  userId: string,
  contains: string,
  prefix: string,
): Promise<ServerSearchResult[]> {
  const rows = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      triggerType: taskTable.triggerType,
      status: taskTable.status,
    })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.workspaceId, workspaceId),
        taskVisibleToViewer(userId),
        inArray(taskTable.status, ['upcoming', 'paused', 'running']),
        or(ilike(taskTable.title, contains), ilike(taskTable.description, contains)),
      ),
    )
    .orderBy(prefixFirst(taskTable.title, prefix), desc(taskTable.updatedAt))
    .limit(SEARCH_RESULTS_PER_GROUP);

  return rows.map((row) => ({
    group: 'scheduled' as const,
    id: row.id,
    title: row.title,
    subtitle:
      row.status === 'paused'
        ? 'Paused'
        : row.triggerType === 'schedule'
          ? 'Runs on a schedule'
          : 'Runs on an event',
    href: '/app/scheduled',
  }));
}
