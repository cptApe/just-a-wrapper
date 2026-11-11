import {
  EXA_SEARCH_CATEGORIES,
  MAX_SEARCH_DOMAIN_CHARS,
  MAX_SEARCH_DOMAINS,
  MAX_SEARCH_QUERY_CHARS,
  MAX_SEARCH_RESULTS,
} from './custom-tools/web-search-exa-contract';
import { EXA_GATE, LIVE_BROWSER_GATE } from './gates';
import { MAX_FETCH_SUBPAGES, MAX_SUBPAGE_TARGET_CHARS } from './lib/exa-contents';
import type { CustomToolDeclaration } from './types';

export const WEB_SEARCH_EXA_DECL: CustomToolDeclaration<'web_search_exa'> = {
  gate: EXA_GATE,
  name: 'web_search_exa',
  description:
    'Search the live web and get back a ranked list of sources, each with a title, URL, and a short snippet of the page. Use this to find current information, look something up, or gather sources before answering. This is a built-in ability: no setup or connection is needed.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to search the web for.',
        maxLength: MAX_SEARCH_QUERY_CHARS,
      },
      numResults: {
        type: 'integer',
        description: 'How many results to return (1-10, default 5).',
        minimum: 1,
        maximum: MAX_SEARCH_RESULTS,
      },
      category: {
        type: 'string',
        enum: [...EXA_SEARCH_CATEGORIES],
        description: 'Optional kind of result to focus on.',
      },
      include_domains: {
        type: 'array',
        description: 'Only return results from these domains or domain paths.',
        items: { type: 'string', minLength: 1, maxLength: MAX_SEARCH_DOMAIN_CHARS },
        maxItems: MAX_SEARCH_DOMAINS,
      },
      exclude_domains: {
        type: 'array',
        description: 'Do not return results from these domains or domain paths.',
        items: { type: 'string', minLength: 1, maxLength: MAX_SEARCH_DOMAIN_CHARS },
        maxItems: MAX_SEARCH_DOMAINS,
      },
      start_published_date: {
        type: 'string',
        format: 'date-time',
        description: 'Only return results published after this ISO 8601 date and time.',
      },
      end_published_date: {
        type: 'string',
        format: 'date-time',
        description: 'Only return results published before this ISO 8601 date and time.',
      },
    },
    required: ['query'],
  },
};

export const BROWSE_PAGE_DECL: CustomToolDeclaration<'browse_page'> = {
  gate: LIVE_BROWSER_GATE,
  name: 'browse_page',
  description:
    'Open one web page in a short-lived real cloud browser and read its main text content back. Prefer this cheap one-shot tool when you only need to read a JavaScript-rendered page. For navigation, interaction, or a login that should persist, use browse_open followed by browse_act instead. This is a built-in ability: no setup or connection is needed.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full http(s) URL of the page to open and read.',
        maxLength: 2048,
      },
    },
    required: ['url'],
  },
};

export const BROWSE_OPEN_DECL: CustomToolDeclaration<'browse_open'> = {
  gate: LIVE_BROWSER_GATE,
  name: 'browse_open',
  description:
    'Open or reuse this task’s live browser and navigate to a URL. The user can watch the browser and temporarily take control. Browser sign-ins persist only for the task creator in this workspace. Other members have separate sign-ins. Use this for interactive or multi-step browsing; use browse_page for a cheap one-shot read.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full http(s) URL to open in the task browser.',
        maxLength: 2048,
      },
    },
    required: ['url'],
  },
};

export const BROWSE_ACT_DECL: CustomToolDeclaration<'browse_act'> = {
  gate: LIVE_BROWSER_GATE,
  name: 'browse_act',
  description:
    'Use the task’s open browser for one natural-language step. Choose act to click, type, or navigate; extract to read information; or observe to list relevant actions available on the current page. Call browse_open first. If the user is driving, wait until they hand control back.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description: 'One precise action, extraction request, or observation request.',
        maxLength: 4000,
      },
      operation: {
        type: 'string',
        enum: ['act', 'extract', 'observe'],
        description: "The Stagehand primitive to use. Defaults to 'act'.",
      },
    },
    required: ['instruction'],
  },
};

export const BROWSE_CLOSE_DECL: CustomToolDeclaration<'browse_close'> = {
  gate: LIVE_BROWSER_GATE,
  name: 'browse_close',
  description:
    'Close this task’s live browser when the interactive browsing work is finished. This stops Browserbase billing; saved workspace logins remain available for future browser sessions.',
  riskLevel: 'safe',
  inputJsonSchema: { type: 'object', properties: {} },
};

export const FETCH_PAGE_DECL: CustomToolDeclaration<'fetch_page'> = {
  gate: EXA_GATE,
  name: 'fetch_page',
  description:
    'Read one or more web pages (up to 5 per call) and get back their content as focused summaries and key passages, or full text. It can also follow linked pages within each site. Faster and cheaper than opening a browser: use this to read articles, docs, and listings when you have URLs. Pass a query to focus the reading on what you actually need. Use browse_page instead only when the page needs real interaction or JavaScript rendering. This is a built-in ability: no setup or connection is needed.',
  riskLevel: 'safe',
  inputJsonSchema: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        description: 'The http(s) URLs of the pages to read (1-5 per call).',
        items: { type: 'string', maxLength: 2048 },
        minItems: 1,
        maxItems: 5,
      },
      query: {
        type: 'string',
        description:
          'Optional focus: what you want from the pages. Sharpens the summaries and selects the most relevant passages.',
        maxLength: 500,
      },
      mode: {
        type: 'string',
        enum: ['brief', 'full'],
        description:
          "Reading depth. 'brief' (default) returns a summary plus key passages per page, token-efficient. 'full' returns the page text, capped.",
      },
      subpages: {
        type: 'integer',
        minimum: 0,
        maximum: MAX_FETCH_SUBPAGES,
        description: `Optional number of linked pages to read from each URL (0-${MAX_FETCH_SUBPAGES}).`,
      },
      subpage_target: {
        description:
          'Optional keyword or keywords that prioritize which linked pages to read, such as api, pricing, or guide.',
        oneOf: [
          { type: 'string', minLength: 1, maxLength: MAX_SUBPAGE_TARGET_CHARS },
          {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: MAX_SUBPAGE_TARGET_CHARS },
            minItems: 1,
          },
        ],
      },
    },
    required: ['urls'],
  },
};
