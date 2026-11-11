// Native tool names match the SDK toolset identifiers.
// Keep metadata imports pure with relative .ts paths so Node tests can load them.
import type { CustomToolName } from '@/features/tool-catalog/declarations';
import type { ToolPolicy } from './types';

/** The sentinel toolkit built-in tool names resolve under in tool_permission. */
export const BUILTIN_TOOLKIT = 'builtin';

export type BuiltinAbilityGroupId = 'web' | 'files' | 'memory' | 'create' | 'skills' | 'schedules';

/**
 * The effective policy a custom tool falls back to when the user has set no
 * explicit row — the display twin of the dispatcher's default: every custom tool
 * runs without asking (`allow`). Tools declared `alwaysAsk` are the exception:
 * their fixed shelf rows park even under this default.
 */
export function customToolDefaultPolicy(): ToolPolicy {
  return 'allow';
}

// Custom rows control our tools in configurable groups; every other row is fixed.
// Gates read the same per-tool policy rows the UI writes so enforcement cannot drift.
export type AbilityRow = {
  /** Stable row id for React keys. */
  id: string;
  label: string;
  group: BuiltinAbilityGroupId;
  access: 'read' | 'write';
  /** Custom tool surfaced on the built-in shelf. */
  custom?: CustomToolName;
  /**
   * A custom tool whose gate ALWAYS parks by design (its declaration sets
   * `alwaysAsk`): a permission switch here would lie because Allow cannot
   * change that it always asks. So the row shows this fixed, non-interactive
   * state label instead of a StateTabs control, making the unavoidable prompt
   * visible rather than presenting a switch that cannot change it. Set together
   * with `custom` so the drift guard still sees the tool.
   */
  fixedLabel?: string;
};

/** The Built-in tab's shelves, in display order; the same shelf layout as Apps and Skills. */
export const BUILTIN_SHELVES = ['Workspace', 'Web and media'] as const;
type BuiltinShelf = (typeof BUILTIN_SHELVES)[number];

export type BuiltinAbilityGroupMeta = {
  id: BuiltinAbilityGroupId;
  name: string;
  /** Which heading the card sits under on the Built-in tab. */
  shelf: BuiltinShelf;
  /** One-line description on the tab card. */
  blurb: string;
  /** The Overview tab body — one or two plain paragraphs, apps register. */
  summary: readonly [string, string];
  /** False for groups whose tools always run: the card has no Actions tab. */
  configurable: boolean;
};

export const BUILTIN_ABILITY_GROUPS: readonly BuiltinAbilityGroupMeta[] = [
  {
    id: 'web',
    name: 'Web',
    shelf: 'Web and media',
    blurb: 'Search the web, open pages, and read interactive sites.',
    summary: [
      'Your agent can search the web, open a page or link you give it, and read interactive sites that need a real browser, then use what it finds in its answer.',
      'In the browser it can click and type on a page, and you can watch or take over.',
    ],
    configurable: false,
  },
  {
    id: 'files',
    name: 'Files and documents',
    shelf: 'Workspace',
    blurb: 'Search, read, save, move, organize, and safely delete Library files.',
    summary: [
      'Your agent works in its own sandboxed workspace. It can read and search the files there, including ones you attach, create and edit files such as drafts, documents, code, and results, and run code to compute, convert, and build things.',
      'In your durable Library, it can search and read files, save new work, move and organize items, and move files or folders to Trash after asking for your approval. Nothing here touches files outside the workspace and Library.',
    ],
    configurable: false,
  },
  {
    id: 'memory',
    name: 'Memory',
    shelf: 'Workspace',
    blurb: 'Write durable memory files you can review and edit.',
    summary: [
      'Your agent remembers durable facts and preferences by writing its own memory files, then reads those files in future chats so you do not have to repeat yourself.',
      'You can review and edit what it remembers on the Memory page. It can also look up current workspace details such as your settings and plan.',
    ],
    configurable: true,
  },
  {
    id: 'create',
    name: 'Create',
    shelf: 'Web and media',
    blurb: 'Make and edit images, and make short videos from a description.',
    summary: [
      'Your agent can create images and short videos from a plain description and save them into your Library, so you can use them right away.',
      'Generating media spends credits, and higher quality or longer clips cost more. You set the default quality on each ability below.',
    ],
    configurable: true,
  },
  {
    id: 'skills',
    name: 'Skills',
    shelf: 'Workspace',
    blurb: 'List, save, update, and delete reusable skills for later tasks.',
    summary: [
      'Your agent can review the skills you have saved and create or revise small folders of instructions it reuses on later tasks that match.',
      'Saving and updating run without interrupting you unless you change their settings below. Deleting a skill permanently removes it and always asks you first.',
    ],
    configurable: true,
  },
  {
    id: 'schedules',
    name: 'Schedules',
    shelf: 'Workspace',
    blurb: 'Create, review, change, pause, and delete recurring work.',
    summary: [
      'Your agent can create recurring schedules, list the schedules you can see, and change when or how they run.',
      'Scheduled runs can spend credits. Your agent can pause a schedule, and deleting one always asks you first.',
    ],
    configurable: true,
  },
];

// Every custom tool belongs on the shelf: a tool without a row fails typecheck at ABILITY_ROWS.
const ABILITY_ROW_LIST = [
  // Web
  {
    id: 'anthropic-web-search',
    label: 'Search the web',
    group: 'web',
    access: 'read',
  },
  {
    id: 'anthropic-web-fetch',
    label: 'Read a web page',
    group: 'web',
    access: 'read',
  },
  {
    id: 'exa-web-search',
    label: 'Search the web',
    group: 'web',
    access: 'read',
    custom: 'web_search_exa',
  },
  {
    id: 'web-read-pages',
    label: 'Read web pages',
    group: 'web',
    access: 'read',
    custom: 'fetch_page',
  },
  {
    id: 'web-browse',
    label: 'Read one interactive page',
    group: 'web',
    access: 'read',
    custom: 'browse_page',
  },
  {
    id: 'web-browser-open',
    label: 'Open a live browser',
    group: 'web',
    access: 'read',
    custom: 'browse_open',
  },
  {
    id: 'web-browser-act',
    label: 'Use a live browser',
    group: 'web',
    access: 'read',
    custom: 'browse_act',
  },
  {
    id: 'web-browser-close',
    label: 'Close a live browser',
    group: 'web',
    access: 'read',
    custom: 'browse_close',
  },
  // Files and documents
  { id: 'file-read', label: 'Read its files', group: 'files', access: 'read' },
  {
    id: 'library-read',
    label: 'List Library folders',
    group: 'files',
    access: 'read',
    custom: 'list_library_folder',
  },
  {
    id: 'library-search',
    label: 'Search your Library',
    group: 'files',
    access: 'read',
    custom: 'search_library',
  },
  {
    id: 'library-file-read',
    label: 'Read Library files',
    group: 'files',
    access: 'read',
    custom: 'read_library_file',
  },
  {
    id: 'library-save',
    label: 'Save to your Library',
    group: 'files',
    access: 'write',
    custom: 'save_to_library',
  },
  {
    id: 'library-move',
    label: 'Move Library items',
    group: 'files',
    access: 'write',
    custom: 'move_library_item',
  },
  {
    id: 'library-folder-create',
    label: 'Create Library folders',
    group: 'files',
    access: 'write',
    custom: 'create_library_folder',
  },
  {
    id: 'library-delete',
    label: 'Move Library items to Trash',
    group: 'files',
    access: 'write',
    custom: 'delete_library_item',
    fixedLabel: 'Always asks you',
  },
  {
    id: 'file-write',
    label: 'Create and edit files',
    group: 'files',
    access: 'write',
  },
  // "Run code" is the sandbox executor; it lives under Files and documents,
  // the sandbox-workspace group.
  { id: 'code-execution', label: 'Run code', group: 'files', access: 'write' },
  // Create
  {
    id: 'image-generate',
    label: 'Make images',
    group: 'create',
    access: 'write',
    custom: 'generate_image',
  },
  {
    id: 'video-generate',
    label: 'Make short videos',
    group: 'create',
    access: 'write',
    custom: 'generate_video',
  },
  // Memory
  {
    id: 'workspace-context',
    label: 'Know your workspace settings and plan',
    group: 'memory',
    access: 'read',
    custom: 'get_user_context',
  },
  // Skills
  {
    id: 'list-skills',
    label: 'List saved skills',
    group: 'skills',
    access: 'read',
    custom: 'list_skills',
  },
  {
    id: 'save-skill',
    label: 'Save skills',
    group: 'skills',
    access: 'write',
    custom: 'save_skill',
    fixedLabel: 'Always asks you',
  },
  {
    id: 'update-skill',
    label: 'Update skills',
    group: 'skills',
    access: 'write',
    custom: 'update_skill',
    fixedLabel: 'Always asks you',
  },
  {
    id: 'delete-skill',
    label: 'Permanently delete skills',
    group: 'skills',
    access: 'write',
    custom: 'delete_skill',
    fixedLabel: 'Always asks you',
  },
  {
    id: 'image-edit',
    label: 'Edit images',
    group: 'create',
    access: 'write',
    custom: 'edit_image',
  },
  {
    id: 'schedule-create',
    label: 'Create schedules',
    group: 'schedules',
    access: 'write',
    custom: 'create_schedule',
  },
  {
    id: 'schedule-list',
    label: 'List schedules',
    group: 'schedules',
    access: 'read',
    custom: 'list_schedules',
  },
  {
    id: 'schedule-update',
    label: 'Update schedules',
    group: 'schedules',
    access: 'write',
    custom: 'update_schedule',
  },
  {
    id: 'schedule-delete',
    label: 'Delete schedules',
    group: 'schedules',
    access: 'write',
    custom: 'delete_schedule',
    fixedLabel: 'Always asks you',
  },
  {
    id: 'conversation-search',
    label: 'Search past conversations',
    group: 'memory',
    access: 'read',
    custom: 'search_conversations',
  },
  {
    id: 'chart-render',
    label: 'Draw charts',
    group: 'create',
    access: 'write',
    custom: 'render_chart',
  },
  {
    id: 'audio-generate',
    label: 'Make audio files',
    group: 'create',
    access: 'write',
    custom: 'generate_audio',
  },
  {
    id: 'audio-transcribe',
    label: 'Transcribe audio and video',
    group: 'create',
    access: 'write',
    custom: 'transcribe_audio',
  },
] satisfies readonly AbilityRow[];

type UnshelvedCustomTool = Exclude<CustomToolName, (typeof ABILITY_ROW_LIST)[number]['custom']>;
export const ABILITY_ROWS: readonly AbilityRow[] = ABILITY_ROW_LIST satisfies [
  UnshelvedCustomTool,
] extends [never]
  ? readonly AbilityRow[]
  : { missingShelfRow: UnshelvedCustomTool };

// The shelf must account for every custom-tool registry entry.
export const SHELF_CATALOG_TOOLS: ReadonlySet<CustomToolName> = new Set(
  ABILITY_ROWS.map((row) => row.custom).filter(
    (name): name is CustomToolName => name !== undefined,
  ),
);

/** True when members may choose how this custom tool runs. */
export function isConfigurableCustomTool(name: string): boolean {
  const row = ABILITY_ROWS.find((ability) => ability.custom === name);
  if (!row) return false;
  return BUILTIN_ABILITY_GROUPS.some((group) => group.id === row.group && group.configurable);
}
