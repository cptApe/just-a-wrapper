// no-effect-fetch — server data reaches the browser through React Query (code standard 5.3).
//
// Flags a call inside a useEffect or useLayoutEffect callback that reads or writes server data:
// `fetch`, `fetchJson`, a function imported from a 'use server' module, or a function in the same
// file that makes one of those calls. Load with useQuery and change with useMutation instead; the
// one lifecycle for optimistic writes is optimisticMutation in src/lib/optimistic-mutation.ts.
// Streams and subscriptions that cannot be a query are named in the `allow` option with a reason.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);
const FETCHERS = new Set(['fetch', 'fetchJson']);
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end', 'tokens', 'comments']);
const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

const serverModuleCache = new Map();

function resolveImport(filename, source) {
  const marker = `${path.sep}src${path.sep}`;
  const at = filename.lastIndexOf(marker);
  let base;
  if (source.startsWith('@/')) {
    if (at === -1) return null;
    base = path.join(filename.slice(0, at + marker.length), source.slice(2));
  } else if (source.startsWith('.')) {
    base = path.resolve(path.dirname(filename), source);
  } else {
    return null;
  }
  for (const extension of ['', ...EXTENSIONS]) {
    const candidate = `${base}${extension}`;
    if (extension === '' && !/\.[cm]?[jt]sx?$/.test(candidate)) continue;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isServerModule(file) {
  if (file === null) return false;
  let cached = serverModuleCache.get(file);
  if (cached === undefined) {
    const head = readFileSync(file, 'utf8')
      .replace(/^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*/, '')
      .trimStart();
    cached = /^(['"])use server\1/.test(head);
    serverModuleCache.set(file, cached);
  }
  return cached;
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item === 'object' && item.type) walk(item, visit);
    } else if (value && typeof value === 'object' && value.type) {
      walk(value, visit);
    }
  }
}

function calleeName(call) {
  const callee = call.callee;
  if (callee.type === 'Identifier') return callee.name;
  // `api.load()` on a namespace import counts as `api`.
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier') {
    return callee.object.name;
  }
  return null;
}

function isFunction(node) {
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';
}

/** The function a local binding holds: a declaration, an arrow, or a useCallback/useMemo body. */
function localFunctionBody(init) {
  if (isFunction(init)) return init.body;
  if (
    init?.type === 'CallExpression' &&
    init.callee.type === 'Identifier' &&
    (init.callee.name === 'useCallback' || init.callee.name === 'useMemo') &&
    isFunction(init.arguments[0])
  ) {
    return init.arguments[0].body;
  }
  return null;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallows fetch and server-action calls inside effects; use React Query and optimisticMutation.',
    },
    messages: {
      effectFetch:
        "'{{name}}' reads or writes server data inside an effect. Load it with useQuery under the feature's key factory and change it with useMutation (optimisticMutation for optimistic writes).",
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: { type: 'string' }, reason: { type: 'string', minLength: 1 } },
              required: ['path', 'reason'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const filename = context.filename;
    const allow = context.options[0]?.allow ?? [];
    if (allow.some((entry) => filename.endsWith(entry.path))) return {};

    const fetching = new Set(FETCHERS);
    const locals = [];
    const effects = [];

    return {
      ImportDeclaration(node) {
        if (node.importKind === 'type') return;
        if (!isServerModule(resolveImport(filename, node.source.value))) return;
        for (const specifier of node.specifiers) {
          if (specifier.importKind !== 'type') fetching.add(specifier.local.name);
        }
      },
      FunctionDeclaration(node) {
        if (node.id) locals.push({ name: node.id.name, body: node.body });
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier') return;
        const body = localFunctionBody(node.init);
        if (body) locals.push({ name: node.id.name, body });
      },
      CallExpression(node) {
        // `useEffect(...)` and `React.useEffect(...)`.
        const hook = node.callee.type === 'MemberExpression' ? node.callee.property : node.callee;
        if (
          hook.type === 'Identifier' &&
          EFFECT_HOOKS.has(hook.name) &&
          isFunction(node.arguments[0])
        ) {
          effects.push(node.arguments[0].body);
        }
      },
      'Program:exit'() {
        // A local function that calls a fetcher is a fetcher, to a fixed point.
        let grew = true;
        while (grew) {
          grew = false;
          for (const local of locals) {
            if (fetching.has(local.name)) continue;
            let calls = false;
            walk(local.body, (node) => {
              if (node.type === 'CallExpression' && fetching.has(calleeName(node))) calls = true;
            });
            if (calls) {
              fetching.add(local.name);
              grew = true;
            }
          }
        }
        for (const body of effects) {
          walk(body, (node) => {
            if (node.type !== 'CallExpression') return;
            const name = calleeName(node);
            if (name !== null && fetching.has(name)) {
              context.report({ node, messageId: 'effectFetch', data: { name } });
            }
          });
        }
      },
    };
  },
};

export default rule;
