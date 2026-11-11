// no-direct-session-read — the auth session is read in src/lib/caller.ts and nowhere else.
// The session's active-organization pointer can outlive a membership, so code that reads it
// directly skips the membership and live-workspace checks that resolveCaller always makes.

function propertyName(node) {
  if (node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal') return String(node.property.value);
  return null;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallows reading the auth session or its active organization outside the caller resolver.',
    },
    messages: {
      sessionRead:
        'Use resolveCaller, findCaller or resolveUser from @/lib/caller instead of auth.api.getSession.',
      activeOrganization:
        'activeOrganizationId can name a workspace the person has left. Use resolveCaller from @/lib/caller.',
    },
    schema: [],
  },

  create(context) {
    return {
      MemberExpression(node) {
        const name = propertyName(node);
        if (name === 'getSession' && propertyName(node.object) === 'api') {
          context.report({ node, messageId: 'sessionRead' });
        }
        if (name === 'activeOrganizationId') {
          context.report({ node, messageId: 'activeOrganization' });
        }
      },
      Property(node) {
        const inPattern = node.parent.type === 'ObjectPattern';
        if (
          inPattern &&
          node.key.type === 'Identifier' &&
          node.key.name === 'activeOrganizationId'
        ) {
          context.report({ node, messageId: 'activeOrganization' });
        }
      },
    };
  },
};

export default rule;
