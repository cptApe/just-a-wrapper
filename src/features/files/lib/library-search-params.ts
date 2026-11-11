import {
  createParser,
  type inferParserType,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs/server';
import { TYPE_FACETS } from './file-types';
import {
  DEFAULT_SORT,
  fileViewFrom,
  type LibraryTab,
  memoryViewFrom,
  parseTabParam,
  parseViewParam,
  type ViewParam,
} from './library-items';
import { isValidFolderPath, normalizeFolderPath, ROOT } from './paths';

// One Library query schema serves client hooks and server reads.
// Refinements replace shallow history; folder paths push because Back leaves a place.
// Parse helpers normalize supported compatibility values and fall back to view defaults.
// See docs/spec/03-patterns.md for the query-state boundary.

const parseAsLibraryTab = createParser({
  parse: (value: string) => parseTabParam(value),
  serialize: (value: LibraryTab) => value,
});

const parseAsView = createParser({
  parse: (value: string) => parseViewParam(value),
  serialize: (value: ViewParam) => value,
});

// The current folder. Validated + normalized — a mangled ?path never crashes
// the page, it just lands at the root.
const parseAsFolderPath = createParser({
  parse: (value: string) => {
    const normalized = normalizeFolderPath(value);
    return normalized !== null && isValidFolderPath(normalized) ? normalized : null;
  },
  serialize: (value: string) => value,
});

export const libraryParsers = {
  tab: parseAsLibraryTab.withDefault('files'),
  view: parseAsView,
  display: parseAsStringLiteral(['grid', 'list'] as const),
  path: parseAsFolderPath.withDefault(ROOT).withOptions({ history: 'push' }),
  scope: parseAsStringLiteral(['you', 'workspace'] as const).withDefault('you'),
  sort: parseAsStringLiteral(['name', 'kind', 'modified', 'size'] as const).withDefault(
    DEFAULT_SORT.key,
  ),
  dir: parseAsStringLiteral(['asc', 'desc'] as const).withDefault(DEFAULT_SORT.dir),
  type: parseAsStringLiteral(TYPE_FACETS),
  trash: parseAsBoolean.withDefault(false),
  q: parseAsString.withDefault(''),
};

export function normalizeLibraryParams(
  params: inferParserType<typeof libraryParsers>,
): inferParserType<typeof libraryParsers> {
  if (params.tab === 'memory')
    return {
      ...params,
      type: null,
      sort: DEFAULT_SORT.key,
      dir: DEFAULT_SORT.dir,
      view: memoryViewFrom(params.view),
    };
  return { ...params, scope: 'you', display: null, view: fileViewFrom(params.view) };
}
