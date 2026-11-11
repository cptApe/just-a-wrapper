import { plural } from '@/lib/format/plural';
import { recordOf } from './record-of';
import {
  destinationFolderOf,
  EDIT,
  fileNameOf,
  fileOr,
  forms,
  hostOf,
  libraryFolderOf,
  libraryPlace,
  okData,
  type Phrase,
  pagesLabel,
  parentFolderOf,
  READ,
  str,
  uniqueHosts,
  verbForms,
  WORK_ON,
  WRITE,
} from './tool-activity-phrases';
import { type KnownToolName, toolCatalog } from './tool-names';

/**
 * Anthropic built-ins (the pre-built agent toolset + memory) and our custom
 * tools, each in all three forms. Keys are tool names exactly as they arrive
 * on `tool_use` events. Done forms read the REAL posted result where it carries
 * a count worth saying; anything else keeps the plain past tense. The batch
 * executor has no entry: describeToolActivity phrases it by the actions it runs.
 */
export const PHRASES = toolCatalog<Phrase>({
  // Anthropic built-ins — the agent_toolset_20260401 surface, exactly the 8
  // names in BUILTIN_TOOL_NAMES (tool-catalog/builtin-tools.ts).
  web_search: () => forms('Searching the web', 'Searched the web', 'search the web'),
  web_fetch: (i) => verbForms(READ, hostOf(i.url) ?? 'a web page'),
  bash: () => forms('Running a command', 'Ran a command', 'run a command'),
  edit: (i) => verbForms(EDIT, fileOr(i, 'a file')),
  read: (i) => verbForms(READ, fileOr(i, 'a file')),
  write: (i) => verbForms(WRITE, fileOr(i, 'a file')),
  glob: () => forms('Finding files', 'Found files', 'find files'),
  grep: () => forms('Searching in files', 'Searched in files', 'search in files'),
  // Older SDK toolset names; a phrase here keeps them readable instead of
  // showing the raw slug.
  code_execution: () => forms('Running code', 'Ran code', 'run code'),
  str_replace_based_edit_tool: (i) => verbForms(WORK_ON, fileOr(i, 'a file')),
  text_editor: (i) => verbForms(WORK_ON, fileOr(i, 'a file')),
  // Anthropic memory tools. Reads are hidden in chat; writes are a soft
  // one-liner that never shows the note itself.
  memory_list: () =>
    forms('Checking notes from earlier', 'Checked notes from earlier', 'check notes from earlier'),
  memory_search: () =>
    forms('Checking notes from earlier', 'Checked notes from earlier', 'check notes from earlier'),
  memory_read: () =>
    forms('Checking notes from earlier', 'Checked notes from earlier', 'check notes from earlier'),
  memory_write: () =>
    forms('Saving a note for next time', 'Saved a note for next time', 'save a note for next time'),
  memory_edit: () =>
    forms(
      'Updating a note for next time',
      'Updated a note for next time',
      'update a note for next time',
    ),
  memory_delete: () => forms('Clearing an old note', 'Cleared an old note', 'clear an old note'),
  // Composio meta-tools (the Tool Router's own plumbing).
  COMPOSIO_SEARCH_TOOLS: () =>
    forms('Finding the right action', 'Found the right action', 'find the right action'),
  COMPOSIO_MANAGE_CONNECTIONS: () =>
    forms('Checking connections', 'Checked connections', 'check connections'),
  COMPOSIO_REMOTE_WORKBENCH: () =>
    forms('Working in the sandbox', 'Worked in the sandbox', 'work in the sandbox'),
  // Known custom tools use curated phrases. Unknown names use describeSlug
  // so stored calls remain readable without bespoke entries.
  save_skill: (i) => {
    const skill = str(i.name);
    const object = skill ? `your ${skill} skill` : 'your skill';
    return verbForms(['Saving', 'Saved', 'save'], object);
  },
  list_skills: (_i, r) => {
    const skills = okData(r)?.skills;
    const done = Array.isArray(skills)
      ? skills.length === 0
        ? 'Found no saved skills'
        : `Found ${plural(skills.length, 'saved skill')}`
      : 'Checked your saved skills';
    return forms('Checking your saved skills', done, 'check your saved skills');
  },
  update_skill: (i) => {
    const skill = str(i.current_name) ?? str(i.name);
    const object = skill ? `your ${skill} skill` : 'your skill';
    return verbForms(['Updating', 'Updated', 'update'], object);
  },
  delete_skill: (i) => {
    const skill = str(i.name);
    const object = skill ? `your ${skill} skill` : 'your skill';
    return verbForms(['Deleting', 'Deleted', 'delete'], object);
  },
  list_library_folder: (i, r) => {
    const folder = libraryFolderOf(i.path);
    const place = folder ? `the ${folder} folder` : 'your Library';
    const entries = okData(r)?.entries;
    const done = Array.isArray(entries)
      ? entries.length === 0
        ? `Found nothing in ${place}`
        : `Found ${plural(entries.length, 'item')} in ${place}`
      : `Looked in ${place}`;
    return forms(`Looking in ${place}`, done, `look in ${place}`);
  },
  search_library: (i, r) => {
    const query = str(i.query);
    const object = query ? `your Library for “${query}”` : 'your Library';
    const results = okData(r)?.results;
    const done = Array.isArray(results)
      ? results.length === 0
        ? `Found nothing in ${object}`
        : `Found ${plural(results.length, 'file')} in ${object}`
      : `Searched ${object}`;
    return forms(`Searching ${object}`, done, `search ${object}`);
  },
  read_library_file: (i, r) => {
    const file = fileNameOf(i.path) ?? 'a Library file';
    const missing = okData(r)?.delivery === 'missing';
    return {
      ...verbForms(READ, file),
      ...(missing ? { done: `Couldn't find ${file} in your Library` } : {}),
    };
  },
  save_to_library: (i, r) => {
    const data = okData(r);
    const requestedFile = fileNameOf(i.filename ?? i.output_filename);
    const file = requestedFile === undefined ? (fileNameOf(data?.path) ?? 'a file') : requestedFile;
    const place = libraryPlace(libraryFolderOf(i.folder_path));
    // The handler answers a save it could not complete with a message and no
    // url (the named session output does not exist).
    const notFound =
      data !== null && typeof data.url !== 'string' && typeof data.message === 'string';
    return {
      ...verbForms(['Saving', 'Saved', 'save'], file, ` to ${place}`),
      ...(notFound ? { done: `Couldn't find ${file} to save` } : {}),
    };
  },
  move_library_item: (i, r) => {
    const from = fileNameOf(i.from_path) ?? 'a Library item';
    const to = fileNameOf(i.to_path);
    const rename =
      to !== undefined && to !== from && parentFolderOf(i.from_path) === parentFolderOf(i.to_path);
    const data = okData(r);
    const notFound = data !== null && data.kind === undefined && typeof data.message === 'string';
    const base = rename
      ? verbForms(['Renaming', 'Renamed', 'rename'], from, ` to ${to}`)
      : verbForms(
          ['Moving', 'Moved', 'move'],
          from,
          ` to ${libraryPlace(destinationFolderOf(i.to_path))}`,
        );
    return {
      ...base,
      ...(notFound ? { done: `Couldn't find ${from} in your Library` } : {}),
    };
  },
  create_library_folder: (i) => {
    const folder = libraryFolderOf(i.path);
    const object = folder ? `a ${folder} folder` : 'a folder';
    return verbForms(['Adding', 'Added', 'add'], object, ' to your Library');
  },
  delete_library_item: (i, r) => {
    const name = fileNameOf(i.path) ?? 'a Library item';
    const data = okData(r);
    const notFound = data !== null && data.kind === undefined && typeof data.message === 'string';
    return {
      ...verbForms(['Moving', 'Moved', 'move'], name, ' to Trash'),
      ...(notFound ? { done: `Couldn't find ${name} in your Library` } : {}),
    };
  },
  get_user_context: () =>
    forms(
      'Checking your workspace details',
      'Checked your workspace details',
      'check your workspace details',
    ),
  // Built-in web abilities (first-party, our keys — src/features/tools). A
  // SEPARATE tool from the Anthropic `web_search` built-in above; same phrasing
  // style, distinct name. The done form counts distinct websites, the same
  // set the expanded source chips show.
  web_search_exa: (_i, r) => {
    const results = okData(r)?.results;
    const hosts = Array.isArray(results)
      ? uniqueHosts(results.map((entry) => recordOf(entry)?.url))
      : [];
    const done =
      hosts.length > 0 ? `Searched ${plural(hosts.length, 'website')}` : 'Searched the web';
    return forms('Searching the web', done, 'search the web');
  },
  browse_page: (i) => {
    const page = hostOf(i.url) ?? 'a web page';
    return forms(
      `Opening ${page} in the browser`,
      `Opened ${page} in the browser`,
      `open ${page} in the browser`,
    );
  },
  fetch_page: (i, r) => {
    const asked = pagesLabel(i.urls);
    const data = okData(r);
    const pages = Array.isArray(data?.pages) ? data.pages : null;
    let done = `Read ${asked}`;
    if (pages) {
      if (pages.length === 0) done = `Couldn't read ${asked}`;
      else if (pages.length === 1) done = `Read ${hostOf(recordOf(pages[0])?.url) ?? 'a web page'}`;
      else done = `Read ${plural(pages.length, 'web page')}`;
    }
    return forms(`Reading ${asked}`, done, `read ${asked}`);
  },
  browse_open: (i) => {
    const host = hostOf(i.url);
    return host
      ? verbForms(['Opening', 'Opened', 'open'], host, ' in the browser')
      : forms('Opening the browser', 'Opened the browser', 'open the browser');
  },
  browse_act: (_i, r) => {
    const data = okData(r);
    const host = hostOf(data?.url);
    const failed = data !== null && data.success === false;
    const done = failed
      ? "Couldn't do that in the browser"
      : host
        ? `Used the browser on ${host}`
        : 'Used the browser';
    return {
      ...forms('Using the browser', done, 'use the browser'),
      ...(host ? { groupSubject: host } : {}),
    };
  },
  browse_close: () => forms('Closing the browser', 'Closed the browser', 'close the browser'),
  generate_image: () => forms('Creating an image', 'Created an image', 'create an image'),
  generate_video: () => forms('Creating a video', 'Created a video', 'create a video'),
  generate_audio: () =>
    forms('Generating audio', 'Generated an audio file', 'generate an audio file'),
  transcribe_audio: (_i, r) => {
    const seconds = okData(r)?.seconds;
    const done =
      typeof seconds === 'number' && Number.isFinite(seconds)
        ? seconds < 60
          ? 'Transcribed a short recording'
          : `Transcribed ${plural(Math.max(1, Math.round(seconds / 60)), 'minute')} of audio`
        : 'Transcribed the recording';
    return forms('Transcribing audio', done, 'transcribe the recording');
  },
  edit_image: (i) => {
    if (i.operation === 'remove_background') {
      return forms('Removing a background', 'Removed the background', 'remove the background');
    }
    if (i.operation === 'upscale') {
      return forms('Upscaling an image', 'Upscaled the image', 'upscale the image');
    }
    return forms('Editing an image', 'Edited the image', 'edit the image');
  },
  create_schedule: (i) => {
    const title = str(i.title);
    return forms(
      'Creating a schedule',
      title ? `Created the schedule ${title}` : 'Created the schedule',
      title ? `create the schedule ${title}` : 'create a schedule',
    );
  },
  list_schedules: (_i, r) => {
    const schedules = okData(r)?.schedules;
    const done = Array.isArray(schedules)
      ? `Listed ${plural(schedules.length, 'schedule')}`
      : 'Listed schedules';
    return forms('Listing schedules', done, 'list schedules');
  },
  update_schedule: (i, r) => {
    const title = str(okData(r)?.title) ?? str(i.title);
    return forms(
      'Updating a schedule',
      title ? `Updated ${title}` : 'Updated a schedule',
      title ? `update ${title}` : 'update a schedule',
    );
  },
  delete_schedule: (i, r) => {
    const title = str(i.title) ?? str(okData(r)?.title);
    return forms(
      'Deleting a schedule',
      title ? `Deleted ${title}` : 'Deleted a schedule',
      title ? `delete the schedule ${title}` : 'delete a schedule',
    );
  },
  search_conversations: (_i, r) => {
    const conversations = okData(r)?.conversations;
    const found = Array.isArray(conversations) ? conversations : null;
    const done = found
      ? `Found ${plural(found.length, 'conversation')}`
      : 'Searched past conversations';
    return forms('Searching past conversations', done, 'search past conversations');
  },
  render_chart: (i) => {
    const title = str(i.title);
    return forms(
      'Drawing a chart',
      title ? `Drew the chart ${title}` : 'Drew a chart',
      'draw a chart',
    );
  },
} satisfies Record<Exclude<KnownToolName, 'COMPOSIO_MULTI_EXECUTE_TOOL'>, Phrase>);
