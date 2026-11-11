// Native tool names match the SDK toolset identifiers.

export const BUILTIN_TOOL_NAMES = [
  'bash',
  'edit',
  'read',
  'write',
  'glob',
  'grep',
  'web_fetch',
  'web_search',
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export function isBuiltinToolName(name: string): name is BuiltinToolName {
  return BUILTIN_TOOL_NAMES.some((toolName) => toolName === name);
}
