import type { CustomToolDeclaration } from './types';

export const SAVE_SKILL_DECL: CustomToolDeclaration<'save_skill'> = {
  name: 'save_skill',
  description:
    'Save a skill to the workspace: a folder of instruction files the agent loads on matching tasks. Creates the skill, or updates it when a custom skill with this name already exists. Every task in the workspace loads it, so this always asks the user before saving.',
  riskLevel: 'destructive',
  alwaysAsk: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The skill display name (1-120 characters).' },
      description: {
        type: 'string',
        description: 'One sentence saying when the skill applies (max 500 characters).',
      },
      files: {
        type: 'array',
        description:
          "The whole skill folder. Must include a root 'SKILL.md' with YAML frontmatter (name, description; optional comma-separated connections). Paths are relative ('SKILL.md', 'references/style.md'); UTF-8 text only.",
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path within the skill folder.' },
            content: { type: 'string', description: 'The file content (UTF-8 text).' },
          },
          required: ['path', 'content'],
        },
      },
    },
    required: ['name', 'files'],
  },
};

export const LIST_SKILLS_DECL: CustomToolDeclaration<'list_skills'> = {
  name: 'list_skills',
  description:
    'List the custom skills saved in this workspace, including each name, description, and last-updated date. Use the optional query to match a skill by name or description.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional text to match against skill names and descriptions.',
      },
    },
  },
};

export const UPDATE_SKILL_DECL: CustomToolDeclaration<'update_skill'> = {
  name: 'update_skill',
  description:
    'Replace a saved custom skill with a revised name, description, and complete folder of instruction files. Use current_name exactly as returned by list_skills. Every task in the workspace loads it, so this always asks the user before updating.',
  riskLevel: 'destructive',
  alwaysAsk: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      current_name: {
        type: 'string',
        description: 'The current skill name, exactly as returned by list_skills.',
      },
      name: { type: 'string', description: 'The revised skill display name.' },
      description: {
        type: 'string',
        description: 'One sentence saying when the revised skill applies.',
      },
      files: {
        type: 'array',
        description:
          "The complete revised skill folder. Must include a root 'SKILL.md'; paths are relative and contents are UTF-8 text.",
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path within the skill folder.' },
            content: { type: 'string', description: 'The file content (UTF-8 text).' },
          },
          required: ['path', 'content'],
        },
      },
    },
    required: ['current_name', 'name', 'files'],
  },
};

export const DELETE_SKILL_DECL: CustomToolDeclaration<'delete_skill'> = {
  name: 'delete_skill',
  description:
    'Permanently delete a custom skill from this workspace and remove its uploaded Anthropic skill. Use the name exactly as returned by list_skills. This always asks the user before running.',
  riskLevel: 'destructive',
  alwaysAsk: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The skill name, exactly as returned by list_skills.' },
    },
    required: ['name'],
  },
};
