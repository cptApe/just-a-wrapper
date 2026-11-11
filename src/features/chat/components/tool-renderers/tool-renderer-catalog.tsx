import {
  IconBarChart01,
  IconBookOpen01,
  IconBrowser,
  IconCalendar,
  IconCode01,
  IconEdit01,
  IconFile02,
  IconFileSearch01,
  IconFileSearch02,
  IconFolder,
  IconFolderSearch,
  IconGlobe01,
  IconGraduationHat01,
  IconHeadphones01,
  IconImage01,
  IconLink01,
  IconMicrophone01,
  IconPencilLine,
  IconSearchMd,
  IconSearchRefraction,
  IconTelescope,
  IconTerminal,
  IconUsers01,
  IconVideoRecorder,
} from '@/components/icons';
import { type KnownToolName, toolCatalog } from '../../lib/tool-names';
import { BrowsePageContent, BrowsePagePreview } from './browse-page-content';
import { BrowserActionDetails } from './browser-action-details';
import {
  BashDetails,
  EditDetails,
  hasBashDetails,
  hasEditDetails,
  hasReadDetails,
  hasWriteDetails,
  ReadDetails,
  WriteDetails,
} from './builtin-code-details';
import { ChartPreviewLoader, hasRenderableChart } from './chart-preview-loader';
import { ComposioDetails } from './composio-details';
import { ConversationSearchDetails } from './conversation-search-details';
import { FetchPageContent } from './fetch-page-content';
import { GeneratedAudioPreview, hasGeneratedAudio } from './generated-audio-preview';
import { GeneratedImagePreview } from './generated-image-preview';
import { GeneratedVideoPreview } from './generated-video-preview';
import { LibraryFileDetails, LibraryReceiptDetails, LibrarySearchResults } from './library-details';
import { LibraryFolderDetails } from './library-folder-details';
import { hasGeneratedImage, hasGeneratedVideo } from './media-result';
import {
  CreateScheduleDetails,
  hasCreateScheduleDetails,
  hasListSchedulesDetails,
  hasUpdateScheduleDetails,
  ListSchedulesDetails,
  UpdateScheduleDetails,
} from './schedule-details';
import { SkillsListDetails } from './skills-list-details';
import type { ToolRendererDescriptor } from './tool-renderer-types';
import { TranscriptDetails } from './transcript-details';
import { WebSearchDetails } from './web-search-details';
import { WebSearchExaResults } from './web-search-exa-results';

export const TOOL_RENDERERS = toolCatalog<ToolRendererDescriptor>({
  // Anthropic built-ins (icon-only entries — the default card body fits them).
  // The enabled set is exactly BUILTIN_TOOL_NAMES in tool-catalog/builtin-tools.ts.
  web_search: {
    description: 'Web search whose result websites unfold as favicon chips.',
    icon: IconSearchMd,
    Details: WebSearchDetails,
  },
  web_fetch: {
    description: 'Reading one web page, shown by host.',
    icon: IconGlobe01,
  },
  bash: {
    description: 'A sandbox command.',
    icon: IconTerminal,
    Details: BashDetails,
    hasDetails: hasBashDetails,
  },
  edit: {
    description: 'File edits in the sandbox.',
    icon: IconEdit01,
    Details: EditDetails,
    hasDetails: hasEditDetails,
  },
  read: {
    description: 'File reads in the sandbox.',
    icon: IconFile02,
    Details: ReadDetails,
    hasDetails: hasReadDetails,
  },
  write: {
    description: 'File writes in the sandbox.',
    icon: IconPencilLine,
    Details: WriteDetails,
    hasDetails: hasWriteDetails,
  },
  // glob/grep are the classic burst producers and carry no user-facing value —
  // hidden in chat (a bodyless row only inside an expanded chain).
  glob: {
    description: 'Finding files by name in the sandbox.',
    icon: IconFolderSearch,
    visibility: 'hidden',
  },
  grep: {
    description: 'Searching file contents in the sandbox.',
    icon: IconFileSearch01,
    visibility: 'hidden',
  },
  // Older toolset names that only need readable fallbacks.
  code_execution: {
    description: 'Code running in the sandbox.',
    icon: IconCode01,
  },
  str_replace_based_edit_tool: {
    description: 'File edits in the sandbox.',
    icon: IconEdit01,
  },
  text_editor: { description: 'File edits in the sandbox.', icon: IconEdit01 },
  // Memory reads never leak content — hidden. Memory writes whisper a soft note.
  memory_list: {
    description: 'Memory store reads.',
    icon: IconBookOpen01,
    visibility: 'hidden',
  },
  memory_search: {
    description: 'Memory store search.',
    icon: IconBookOpen01,
    visibility: 'hidden',
  },
  memory_read: {
    description: 'Memory store reads.',
    icon: IconBookOpen01,
    visibility: 'hidden',
  },
  memory_write: {
    description: 'Memory store writes.',
    icon: IconBookOpen01,
    visibility: 'whisper',
  },
  memory_edit: {
    description: 'Memory store writes.',
    icon: IconBookOpen01,
    visibility: 'whisper',
  },
  memory_delete: {
    description: 'Memory store writes.',
    icon: IconBookOpen01,
    visibility: 'whisper',
  },
  // Composio meta-tools.
  COMPOSIO_SEARCH_TOOLS: {
    description: 'The Tool Router looking up the right action.',
    icon: IconSearchRefraction,
  },
  // These two carry no recognized verb, so the dynamic read/write default would
  // call them writes and render them as product receipts. They are the router's
  // own bookkeeping, not an action the user asked for: pin them to process.
  COMPOSIO_MANAGE_CONNECTIONS: {
    description: 'Connection checks against the Tool Router.',
    icon: IconLink01,
    visibility: 'process',
  },
  COMPOSIO_REMOTE_WORKBENCH: {
    description: 'Tool Router sandbox work.',
    icon: IconTerminal,
    visibility: 'process',
  },
  COMPOSIO_MULTI_EXECUTE_TOOL: {
    description: 'Connected-app action results, unwrapped from the router envelope.',
    Details: ComposioDetails,
    failedPresentation: 'details-only',
  },
  // Hide get_user_context and its raw output in chat. Unknown tools use the
  // default card and describeSlug fallback so stored calls remain readable.
  get_user_context: {
    description: 'Silent workspace-context read: hidden in chat, its result never rendered.',
    icon: IconUsers01,
    visibility: 'hidden',
  },
  save_skill: {
    description: 'Saving a skill folder: whispers a soft one-liner, never the folder content.',
    icon: IconGraduationHat01,
    visibility: 'whisper',
  },
  list_skills: {
    description: 'Listing saved skills: a quiet read with the count in its settled line.',
    icon: IconGraduationHat01,
    visibility: 'process',
    Details: SkillsListDetails,
  },
  update_skill: {
    description: 'Updating a skill folder: whispers a soft one-liner, never the folder content.',
    icon: IconGraduationHat01,
    visibility: 'whisper',
  },
  delete_skill: {
    description: 'Permanent skill deletion that always asks before showing a standalone receipt.',
    icon: IconGraduationHat01,
    visibility: 'product',
    disclosure: 'none',
  },
  list_library_folder: {
    description: 'Library folder listing: entries render as a readable file list.',
    icon: IconFolder,
    Details: LibraryFolderDetails,
  },
  search_library: {
    description: 'Quiet Library filename search: matches unfold as a file list.',
    icon: IconFolderSearch,
    visibility: 'process',
    Details: LibrarySearchResults,
  },
  read_library_file: {
    description:
      'Quiet Library file read or mount: what was delivered unfolds, never the whole file.',
    icon: IconFileSearch01,
    visibility: 'process',
    Details: LibraryFileDetails,
  },
  save_to_library: {
    description: 'Durable Library save receipt: the saved path unfolds as a Library link.',
    icon: IconFile02,
    visibility: 'product',
    Details: LibraryReceiptDetails,
  },
  move_library_item: {
    description: 'Library move or rename receipt: the new path unfolds as a Library link.',
    icon: IconFolder,
    visibility: 'product',
    Details: LibraryReceiptDetails,
  },
  create_library_folder: {
    description: 'Library folder creation receipt shown entirely by its activity line.',
    icon: IconFolder,
    visibility: 'product',
    disclosure: 'none',
  },
  delete_library_item: {
    description: 'Recoverable Library delete that always asks: the Trash note unfolds.',
    icon: IconFolder,
    visibility: 'product',
    Details: LibraryReceiptDetails,
    consequence: 'It stays in Trash for 30 days, so you can bring it back.',
  },
  // Built-in web abilities (first-party, our keys). Custom tools mechanically,
  // but the agent's own capabilities — no connection, no user-visible key.
  // Glyphs are deliberately DISTINCT from the Anthropic built-ins above
  // (web_search → IconSearchMd, web_fetch → IconGlobe01) so the two searchers /
  // two page-readers read apart at a glance.
  web_search_exa: {
    description: 'Web search (Exa): the websites it came back with unfold as favicon chips.',
    icon: IconTelescope,
    Details: WebSearchExaResults,
  },
  browse_page: {
    description:
      'Cloud browser (Browserbase): the replay card stays visible and plain page text unfolds.',
    icon: IconBrowser,
    Preview: BrowsePagePreview,
    Details: BrowsePageContent,
  },
  // The live task browser (Browserbase + Stagehand). Open and close are one
  // soft line each — the session is watched in the side panel, not read in the
  // thread — while an action unfolds the instruction and what came back.
  browse_open: {
    description: 'Opening the live task browser: one soft line, the panel is the surface.',
    icon: IconBrowser,
    visibility: 'whisper',
  },
  browse_act: {
    description: 'A live browser action: the instruction and its outcome unfold.',
    icon: IconBrowser,
    Details: BrowserActionDetails,
  },
  browse_close: {
    description: 'Closing the live task browser: one soft line.',
    icon: IconBrowser,
    visibility: 'whisper',
  },
  // Exa deepening: page reading. Details render one readable row per page
  // read, with any unreadable URLs listed plainly beneath.
  fetch_page: {
    description: 'Page reading (Exa): summaries and key passages from fetched pages.',
    icon: IconFileSearch02,
    Details: FetchPageContent,
  },
  transcribe_audio: {
    description: 'Audio transcription: a readable transcript with an optional Library link.',
    icon: IconMicrophone01,
    visibility: 'process',
    Details: TranscriptDetails,
  },
  create_schedule: {
    description: 'Schedule receipt with its cadence and prompt.',
    icon: IconCalendar,
    visibility: 'product',
    Details: CreateScheduleDetails,
    hasDetails: hasCreateScheduleDetails,
  },
  list_schedules: {
    description: 'Schedule list with titles, cadence, and paused state.',
    icon: IconCalendar,
    visibility: 'process',
    Details: ListSchedulesDetails,
    hasDetails: hasListSchedulesDetails,
  },
  update_schedule: {
    description: 'Schedule update with only the changed fields.',
    icon: IconCalendar,
    visibility: 'product',
    Details: UpdateScheduleDetails,
    hasDetails: hasUpdateScheduleDetails,
  },
  delete_schedule: {
    description: 'Permanent schedule deletion receipt.',
    icon: IconCalendar,
    visibility: 'product',
    disclosure: 'none',
    consequence: 'This schedule will stop and cannot be restored.',
  },
  search_conversations: {
    description: 'Conversation title and message matches linked to their tasks.',
    icon: IconSearchMd,
    visibility: 'process',
    Details: ConversationSearchDetails,
  },
  // The built-in image verb (pinned GPT Image 2.5 Flare on fal): the shimmer treatment
  // — a shimmer skeleton under the running line, the saved Library image alone
  // (frameless) once done.
  generate_image: {
    description: 'Image generation: shimmer skeleton, then the saved image alone (frameless).',
    icon: IconImage01,
    visibility: 'product',
    Preview: GeneratedImagePreview,
    frameless: true,
    canRenderFrameless: hasGeneratedImage,
  },
  // The built-in short-video verb (pinned Seedance 2.0 on fal): same
  // shimmer treatment — skeleton while it runs, the saved clip alone once done.
  generate_video: {
    description: 'Video generation: shimmer skeleton, then the saved clip alone (frameless).',
    icon: IconVideoRecorder,
    visibility: 'product',
    Preview: GeneratedVideoPreview,
    frameless: true,
    canRenderFrameless: hasGeneratedVideo,
  },
  edit_image: {
    description: 'Image editing: shimmer skeleton, then the saved image alone (frameless).',
    icon: IconImage01,
    visibility: 'product',
    Preview: GeneratedImagePreview,
    frameless: true,
    canRenderFrameless: hasGeneratedImage,
  },
  render_chart: {
    description: 'Conversation chart with an inline preview and shared canvas view.',
    icon: IconBarChart01,
    visibility: 'product',
    Preview: ChartPreviewLoader,
    frameless: true,
    canRenderFrameless: hasRenderableChart,
  },
  generate_audio: {
    description: 'Audio generation: a compact player for the saved Library file.',
    icon: IconHeadphones01,
    visibility: 'product',
    Preview: GeneratedAudioPreview,
    frameless: true,
    canRenderFrameless: hasGeneratedAudio,
  },
} satisfies Record<KnownToolName, ToolRendererDescriptor>);
