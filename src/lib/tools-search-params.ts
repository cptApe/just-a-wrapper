import { createParser, type inferParserType } from 'nuqs/server';

// One Tools query schema controls tab, active-tab search and Apps connection status.
// Use shallow replacement history. Skills and Built-in have no extra facets;
// unsupported source/perm keys are inert. Sorting belongs to table columns.

const TOOLS_TABS = ['apps', 'skills', 'built-in'] as const;
export type ToolsTab = (typeof TOOLS_TABS)[number];

const APP_STATUS_FILTERS = ['all', 'connected', 'not-connected'] as const;

function enumParser<T extends string>(values: readonly T[]) {
  return createParser<T>({
    parse: (value: string) => values.find((candidate) => candidate === value) ?? null,
    serialize: (value) => value,
  });
}

export const toolsParsers = {
  tab: enumParser(TOOLS_TABS).withDefault('apps'),
  q: createParser({
    parse: (value: string) => value,
    serialize: (value: string) => value,
  }).withDefault(''),
  status: enumParser(APP_STATUS_FILTERS).withDefault('all'),
};

export function normalizeToolsParams(
  params: inferParserType<typeof toolsParsers>,
): inferParserType<typeof toolsParsers> {
  return params.tab === 'apps' ? params : { ...params, status: 'all' };
}
