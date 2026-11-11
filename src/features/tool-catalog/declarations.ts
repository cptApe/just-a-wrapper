// Pure metadata shared by seeding and dispatch: names, descriptions, risks and schemas.
// Anthropic tool names allow 1-128 characters from [A-Za-z0-9_-].

import type { Capabilities } from '@/lib/capabilities';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { type BuiltinToolName, isBuiltinToolName } from './builtin-tools';
import { EDIT_IMAGE_DECL } from './edit-image';
import { ANTHROPIC_WEB_GATE, type ToolGate } from './gates';
import { GENERATE_IMAGE_DECL } from './generate-image';
import { GENERATE_VIDEO_DECL } from './generate-video';
import { GET_USER_CONTEXT_DECL } from './get-user-context';
import {
  CREATE_LIBRARY_FOLDER_DECL,
  DELETE_LIBRARY_ITEM_DECL,
  LIST_LIBRARY_FOLDER_DECL,
  MOVE_LIBRARY_ITEM_DECL,
  READ_LIBRARY_FILE_DECL,
  SAVE_TO_LIBRARY_DECL,
  SEARCH_LIBRARY_DECL,
} from './library-declarations';
import { RENDER_CHART_DECL } from './render-chart';
import {
  CREATE_SCHEDULE_DECL,
  DELETE_SCHEDULE_DECL,
  LIST_SCHEDULES_DECL,
  UPDATE_SCHEDULE_DECL,
} from './schedule-declarations';
import {
  DELETE_SKILL_DECL,
  LIST_SKILLS_DECL,
  SAVE_SKILL_DECL,
  UPDATE_SKILL_DECL,
} from './skill-declarations';
import type { CustomToolDeclaration } from './types';
import { GENERATE_AUDIO_DECL, TRANSCRIBE_AUDIO_DECL } from './voice';
import {
  BROWSE_ACT_DECL,
  BROWSE_CLOSE_DECL,
  BROWSE_OPEN_DECL,
  BROWSE_PAGE_DECL,
  FETCH_PAGE_DECL,
  WEB_SEARCH_EXA_DECL,
} from './web-declarations';

export const SEARCH_CONVERSATIONS_DECL: CustomToolDeclaration<'search_conversations'> = {
  name: 'search_conversations',
  description:
    'Search visible past conversations by title, user messages, and final assistant replies. Tool results are not searched, and only the most recent text of very long chats is kept. Older chats that have not been indexed yet may match by title only; the result reports how many. Matching results are rendered as links in the chat. Never paste, invent, or convert their paths into absolute URLs. Do not use this to search Library files or memory.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
        description: 'Words or a phrase to find in conversation titles or messages.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 25,
        description: 'Maximum matches to return. Defaults to 10.',
      },
    },
    required: ['query'],
  },
};

export const TOOL_DECLARATIONS = [
  SAVE_SKILL_DECL,
  LIST_SKILLS_DECL,
  UPDATE_SKILL_DECL,
  DELETE_SKILL_DECL,
  LIST_LIBRARY_FOLDER_DECL,
  SEARCH_LIBRARY_DECL,
  READ_LIBRARY_FILE_DECL,
  SAVE_TO_LIBRARY_DECL,
  MOVE_LIBRARY_ITEM_DECL,
  CREATE_LIBRARY_FOLDER_DECL,
  DELETE_LIBRARY_ITEM_DECL,
  WEB_SEARCH_EXA_DECL,
  BROWSE_PAGE_DECL,
  BROWSE_OPEN_DECL,
  BROWSE_ACT_DECL,
  BROWSE_CLOSE_DECL,
  FETCH_PAGE_DECL,
  GENERATE_IMAGE_DECL,
  GENERATE_VIDEO_DECL,
  GET_USER_CONTEXT_DECL,
  EDIT_IMAGE_DECL,
  CREATE_SCHEDULE_DECL,
  LIST_SCHEDULES_DECL,
  UPDATE_SCHEDULE_DECL,
  DELETE_SCHEDULE_DECL,
  SEARCH_CONVERSATIONS_DECL,
  RENDER_CHART_DECL,
  GENERATE_AUDIO_DECL,
  TRANSCRIBE_AUDIO_DECL,
] as const satisfies readonly CustomToolDeclaration<string>[];

export type CustomToolName = (typeof TOOL_DECLARATIONS)[number]['name'];

export const CUSTOM_TOOL_NAMES: readonly CustomToolName[] = TOOL_DECLARATIONS.map(
  (declaration) => declaration.name,
);

export function isCustomToolName(name: string): name is CustomToolName {
  return CUSTOM_TOOL_NAMES.some((candidate) => candidate === name);
}

export type CustomToolPlan = {
  type: 'custom';
  name: CustomToolName;
  description: string;
  input_schema: CustomToolDeclaration['inputJsonSchema'];
};

// Built-in tools have no declaration of ours, so their gates are listed here.
const BUILTIN_TOOL_GATES = {
  web_search: ANTHROPIC_WEB_GATE,
  web_fetch: ANTHROPIC_WEB_GATE,
} satisfies Partial<Record<BuiltinToolName, ToolGate>>;

// The one map from a tool to the capability that offers it, read from each declaration's gate.
const GATE_BY_NAME: ReadonlyMap<string, ToolGate> = new Map([
  ...TOOL_DECLARATIONS.flatMap(
    ({ name, gate }: CustomToolDeclaration): Array<[string, ToolGate]> =>
      gate ? [[name, gate]] : [],
  ),
  ...Object.entries(BUILTIN_TOOL_GATES),
]);

function isGateOpen(gate: ToolGate, capabilities: Capabilities): boolean {
  return capabilities[gate.capability].kind === gate.on;
}

/** Whether the capability that gates this tool is configured; an ungated tool is always on. */
export function isGatedToolOn(
  name: CustomToolName | BuiltinToolName,
  capabilities: Capabilities,
): boolean {
  const gate = GATE_BY_NAME.get(name);
  return gate ? isGateOpen(gate, capabilities) : true;
}

export function isToolAvailable(name: string, capabilities: Capabilities): boolean {
  const gate = GATE_BY_NAME.get(name);
  if (gate) return isGateOpen(gate, capabilities);
  return isCustomToolName(name) || isBuiltinToolName(name);
}

export function toolOffMessage(
  name: CustomToolName | BuiltinToolName,
  capabilities: Capabilities,
): string | null {
  if (isToolAvailable(name, capabilities)) return null;
  const offMessage = GATE_BY_NAME.get(name)?.offMessage;
  return offMessage ? CAPABILITY_OFF_MESSAGES[offMessage] : null;
}

export function customToolDeclarations(capabilities: Capabilities): CustomToolPlan[] {
  return TOOL_DECLARATIONS.filter((tool) => isToolAvailable(tool.name, capabilities)).map((d) => ({
    type: 'custom',
    name: d.name,
    description: d.description,
    input_schema: d.inputJsonSchema,
  }));
}
