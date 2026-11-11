// no-raw-env-read: app code reads configuration through @/lib/env, so /admin/environment can
// list every key the app uses. A raw `process.env.NAME` is allowed only for the names in `allow`,
// each of which is set by the runtime or has its own row in the environment registry.

/** Set by Node, Next or Vercel, so there is nothing for an operator to configure. */
export const PLATFORM_ENV_KEYS = ['NODE_ENV', 'NEXT_RUNTIME', 'VERCEL_ENV'];

/** Read raw because Next inlines NEXT_PUBLIC_* only at a literal process.env.NAME; each has a registry row. */
export const INLINED_PUBLIC_ENV_KEYS = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_E2E',
  'NEXT_PUBLIC_VERCEL_ENV',
];

/** Read raw only by src/lib/brand/identity.ts, the one reader of the brand name. */
export const BRAND_ENV_KEYS = ['NEXT_PUBLIC_BRAND_NAME'];

function envKey(node) {
  if (node.computed || node.property.type !== 'Identifier') return null;
  const object = node.object;
  const isProcessEnv =
    object.type === 'MemberExpression' &&
    !object.computed &&
    object.object.type === 'Identifier' &&
    object.object.name === 'process' &&
    object.property.type === 'Identifier' &&
    object.property.name === 'env';
  return isProcessEnv ? node.property.name : null;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallows process.env.NAME reads in app code except for an allowed list of names.',
    },
    messages: {
      rawEnvRead:
        'Read {{name}} through env from @/lib/env so /admin/environment lists it. A key the schema cannot hold needs a registry row and a place in the allow lists in eslint-rules/no-raw-env-read.mjs.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const allowed = new Set(context.options[0]?.allow ?? []);
    return {
      MemberExpression(node) {
        const name = envKey(node);
        if (name !== null && !allowed.has(name)) {
          context.report({ node, messageId: 'rawEnvRead', data: { name } });
        }
      },
    };
  },
};

export default rule;
