import { type CustomToolName, isToolAvailable } from '@/features/tool-catalog/declarations';
import type { Capabilities } from '@/lib/capabilities';
import { type BoundTool, bindTool } from './lib/bind-tool';

// Exhaustive handler wiring stays lazy so pure availability reads load no DB or providers.
const toolLoaders: Record<CustomToolName, () => Promise<BoundTool>> = {
  save_skill: async () => bindTool((await import('./custom-tools/save-skill')).saveSkillTool),
  list_skills: async () => bindTool((await import('./custom-tools/list-skills')).listSkillsTool),
  update_skill: async () => bindTool((await import('./custom-tools/update-skill')).updateSkillTool),
  delete_skill: async () => bindTool((await import('./custom-tools/delete-skill')).deleteSkillTool),
  list_library_folder: async () =>
    bindTool((await import('./custom-tools/list-library-folder')).listLibraryFolderTool),
  search_library: async () =>
    bindTool((await import('./custom-tools/library-verbs')).searchLibraryTool),
  read_library_file: async () =>
    bindTool((await import('./custom-tools/library-verbs')).readLibraryFileTool),
  save_to_library: async () =>
    bindTool((await import('./custom-tools/library-verbs')).saveToLibraryTool),
  move_library_item: async () =>
    bindTool((await import('./custom-tools/library-verbs')).moveLibraryItemTool),
  create_library_folder: async () =>
    bindTool((await import('./custom-tools/library-verbs')).createLibraryFolderTool),
  delete_library_item: async () =>
    bindTool((await import('./custom-tools/library-verbs')).deleteLibraryItemTool),
  web_search_exa: async () =>
    bindTool((await import('./custom-tools/web-search-exa')).webSearchExaTool),
  browse_page: async () => bindTool((await import('./custom-tools/browse-page')).browsePageTool),
  browse_open: async () => bindTool((await import('./custom-tools/browse-open')).browseOpenTool),
  browse_act: async () => bindTool((await import('./custom-tools/browse-act')).browseActTool),
  browse_close: async () => bindTool((await import('./custom-tools/browse-close')).browseCloseTool),
  fetch_page: async () => bindTool((await import('./custom-tools/fetch-page')).fetchPageTool),
  generate_image: async () =>
    bindTool((await import('./custom-tools/generate-image')).generateImageTool),
  generate_video: async () =>
    bindTool((await import('./custom-tools/generate-video')).generateVideoTool),
  get_user_context: async () =>
    bindTool((await import('./custom-tools/get-user-context')).getUserContextTool),
  edit_image: async () => bindTool((await import('./custom-tools/edit-image')).editImageTool),
  create_schedule: async () =>
    bindTool((await import('./custom-tools/schedules')).createScheduleTool),
  list_schedules: async () =>
    bindTool((await import('./custom-tools/schedules')).listSchedulesTool),
  update_schedule: async () =>
    bindTool((await import('./custom-tools/schedules')).updateScheduleTool),
  delete_schedule: async () =>
    bindTool((await import('./custom-tools/schedules')).deleteScheduleTool),
  search_conversations: async () =>
    bindTool((await import('./custom-tools/search-conversations')).searchConversationsTool),
  render_chart: async () => bindTool((await import('./custom-tools/render-chart')).renderChartTool),
  generate_audio: async () => bindTool((await import('./custom-tools/voice')).generateAudioTool),
  transcribe_audio: async () =>
    bindTool((await import('./custom-tools/voice')).transcribeAudioTool),
};

export function buildCustomToolRegistry(
  capabilities: Capabilities,
): ReadonlyMap<string, () => Promise<BoundTool>> {
  return new Map(
    Object.entries(toolLoaders).filter(([name]) => isToolAvailable(name, capabilities)),
  );
}
