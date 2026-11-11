import type { CustomToolDeclaration } from './types';

export const LIST_LIBRARY_FOLDER_DECL: CustomToolDeclaration<'list_library_folder'> = {
  name: 'list_library_folder',
  description:
    'List one level of the workspace Library at a folder path ("/" is the Library root). Returns files and subfolders with paths you can pass to read_library_file or back to this tool. The Library is durable and separate from the session sandbox.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'The Library folder path to list. Use "/" for the root, or a subfolder path returned by a previous call to go deeper.',
      },
    },
    required: ['path'],
  },
};

export const SEARCH_LIBRARY_DECL: CustomToolDeclaration<'search_library'> = {
  name: 'search_library',
  description: 'Find visible files in the Library by filename, across all folders.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Filename text to search for.', minLength: 1 },
      type: {
        type: 'string',
        enum: ['documents', 'images', 'pdfs', 'spreadsheets', 'presentations'],
        description: 'Optional file type filter.',
      },
    },
    required: ['query'],
  },
};

export const READ_LIBRARY_FILE_DECL: CustomToolDeclaration<'read_library_file'> = {
  name: 'read_library_file',
  description:
    'Read a visible Library file by path. Text is returned inline; images and other binary files are mounted into the session sandbox.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Full Library file path.' } },
    required: ['path'],
  },
};

export const SAVE_TO_LIBRARY_DECL: CustomToolDeclaration<'save_to_library'> = {
  name: 'save_to_library',
  description:
    'Save inline text or a file from this session outputs into the durable Library. Creates missing destination folders. Name collisions receive a unique suffix; the returned path is authoritative.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Inline UTF-8 text, up to 256 KB.' },
      output_filename: {
        type: 'string',
        description: 'Filename of a file the agent wrote to its session outputs.',
      },
      folder_path: { type: 'string', description: 'Destination Library folder path.' },
      filename: {
        type: 'string',
        description:
          'Destination filename. Required for inline content; optional rename for output files.',
      },
    },
    required: ['folder_path'],
  },
};

export const MOVE_LIBRARY_ITEM_DECL: CustomToolDeclaration<'move_library_item'> = {
  name: 'move_library_item',
  description:
    'Move or rename a visible Library file or folder. Destination folders are created when missing.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      from_path: { type: 'string', description: 'Current full Library path.' },
      to_path: { type: 'string', description: 'New full Library path.' },
    },
    required: ['from_path', 'to_path'],
  },
};

export const CREATE_LIBRARY_FOLDER_DECL: CustomToolDeclaration<'create_library_folder'> = {
  name: 'create_library_folder',
  description: 'Create a Library folder and any missing intermediate folders.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Full Library folder path.' } },
    required: ['path'],
  },
};

export const DELETE_LIBRARY_ITEM_DECL: CustomToolDeclaration<'delete_library_item'> = {
  name: 'delete_library_item',
  description:
    'Move a visible Library file or folder subtree to Trash. It is recoverable for 30 days and always asks the user before running.',
  riskLevel: 'destructive',
  alwaysAsk: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Full Library item path to move to Trash.' },
    },
    required: ['path'],
  },
};
