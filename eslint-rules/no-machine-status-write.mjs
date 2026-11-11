// Each persisted lifecycle has one writer. Match imported table identities, not local names.
const owners = {
  session: {
    status: 'sessions/api/session-transitions.ts',
    browserbaseSessionStatus: 'tools/api/browser-transitions.ts',
    browserLeaseExpiresAt: 'tools/api/browser-transitions.ts',
    visibility: 'sessions/api/share-transitions.ts',
    hiddenAt: 'sessions/api/session-transitions.ts',
    providerArchivedAt: 'sessions/api/session-transitions.ts',
  },
  sessionShare: { revokedAt: 'sessions/api/share-transitions.ts' },
  folderShare: { revokedAt: 'files/api/share-transitions.ts' },
  file: { deletedAt: 'files/api/trash-transitions.ts' },
  folder: { deletedAt: 'files/api/trash-transitions.ts' },
  sessionSend: {
    status: 'sessions/api/session-send-transitions.ts',
    attemptToken: 'sessions/api/session-send-transitions.ts',
    recoverAfter: 'sessions/api/session-send-transitions.ts',
  },
  task: {
    status: 'tasks/api/task-transitions.ts',
    providerSync: 'tasks/api/task-transitions.ts',
    syncClaimedAt: 'tasks/api/task-transitions.ts',
    runNowClaimedAt: 'tasks/api/task-transitions.ts',
  },
  workspace: {
    budgetSyncStatus: 'billing/api/budget-sync-transitions.ts',
    budgetSyncLease: 'billing/api/budget-sync-transitions.ts',
    budgetSyncLeaseUntil: 'billing/api/budget-sync-transitions.ts',
    lifecycleStatus: 'workspaces/api/workspace-lifecycle-transitions.ts',
    deletedAt: 'workspaces/api/workspace-lifecycle-transitions.ts',
    purgeAttemptedAt: 'workspaces/api/workspace-lifecycle-transitions.ts',
  },
  user: {
    accountStatus: 'auth/api/account-lifecycle-transitions.ts',
    deletedAt: 'auth/api/account-lifecycle-transitions.ts',
  },
  workspaceMember: {
    vaultStatus: 'integrations/api/vault-transitions.ts',
    vaultClaimedAt: 'integrations/api/vault-transitions.ts',
    provisioningStatus: 'workspaces/api/provisioning-transitions.ts',
    toolRouterGeneration: 'integrations/api/tool-router-transitions.ts',
  },
  integration: { status: 'integrations/api/connection-transitions.ts' },
  integrationCleanup: {
    status: 'integrations/api/member-cleanup-transitions.ts',
    claimedAt: 'integrations/api/member-cleanup-transitions.ts',
    purgeAttemptedAt: 'integrations/api/member-cleanup-transitions.ts',
  },
  sharedIntegration: { status: 'integrations/api/shared-connection-transitions.ts' },
  invitation: { status: 'workspaces/api/invitation-transitions.ts' },
  skill: { status: 'skills/api/skill-transitions.ts' },
  autoTopupAttempt: {
    status: 'billing/api/auto-topup-transitions.ts',
    paymentMethodId: 'billing/api/auto-topup-transitions.ts',
  },
  manualTopupAttempt: { status: 'billing/api/manual-topup-transitions.ts' },
  creditGrant: { status: 'billing/api/credit-grant-transitions.ts' },
  usageEvent: { settlementStatus: 'billing/api/usage-settlement-transitions.ts' },
  notification: {
    emailStatus: 'notifications/api/notification-transitions.ts',
    emailClaimedAt: 'notifications/api/notification-transitions.ts',
  },
  customToolDispatch: { status: 'tools/api/tool-delivery-transitions.ts' },
  browserCandidate: { status: 'tools/api/browser-candidates.ts' },
  pendingConfirmation: { status: 'tools/api/tool-delivery-transitions.ts' },
};
// A new row may start in a state without going through the transition (a cancelled run is born hidden, a task run inherits visibility).
const insertDefaults = new Set(['session.hiddenAt', 'session.visibility']);
// Every row write of these tables needs the workspace ledger lock that only these modules take.
const tableOwners = {
  creditGrant: ['billing/api/credit-grant-transitions.ts'],
};

export { owners };

function key(node) {
  return node?.type === 'Identifier'
    ? node.name
    : node?.type === 'Literal'
      ? node.value
      : undefined;
}
function method(node) {
  return node?.type === 'CallExpression' && node.callee.type === 'MemberExpression'
    ? key(node.callee.property)
    : undefined;
}
const rule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      owned: '{{table}}.{{column}} is machine-owned. Write it in src/features/{{owner}}.',
      ownedTable: '{{table}} rows are written only in {{owners}}.',
    },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    if (/(?:^|\/)(?:tests|migrations)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filename)) return {};
    const source = context.sourceCode;
    function definition(node) {
      if (node?.type !== 'Identifier') return undefined;
      let scope = source.getScope(node);
      while (scope) {
        const variable = scope.set.get(node.name);
        if (variable) return variable.defs[0];
        scope = scope.upper;
      }
    }
    function resolve(node, seen = new Set()) {
      if (!node || seen.has(node)) return node;
      seen.add(node);
      if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression')
        return resolve(node.expression, seen);
      const def = definition(node);
      return def?.type === 'Variable' && def.node.init ? resolve(def.node.init, seen) : node;
    }
    function tableName(node) {
      node = resolve(node);
      const def = definition(node);
      if (
        def?.type === 'ImportBinding' &&
        /(?:^|\/)db\/schema(?:\/|$)/.test(def.parent.source.value)
      )
        return key(def.node.imported);
      if (node?.type === 'MemberExpression') {
        const namespace = definition(node.object);
        if (
          namespace?.type === 'ImportBinding' &&
          /(?:^|\/)db\/schema(?:\/|$)/.test(namespace.parent.source.value)
        )
          return key(node.property);
      }
    }
    function findTable(node) {
      node = resolve(node);
      if (method(node) === 'update' || method(node) === 'insert')
        return tableName(node.arguments[0]);
      return node?.type === 'CallExpression' && node.callee.type === 'MemberExpression'
        ? findTable(node.callee.object)
        : undefined;
    }
    function properties(node, seen = new Set()) {
      node = resolve(node);
      if (!node || seen.has(node)) return [];
      seen.add(node);
      if (node.type === 'ArrayExpression')
        return node.elements.flatMap((entry) => properties(entry, seen));
      if (node.type === 'ConditionalExpression')
        return [...properties(node.consequent, seen), ...properties(node.alternate, seen)];
      if (node.type !== 'ObjectExpression') return [];
      return node.properties.flatMap((property) =>
        property.type === 'SpreadElement' ? properties(property.argument, seen) : [property],
      );
    }
    return {
      CallExpression(node) {
        const operation = method(node);
        if (!['set', 'values', 'onConflictDoUpdate'].includes(operation)) return;
        const table = findTable(node.callee.object);
        const writers = table && tableOwners[table];
        if (writers && !writers.some((owner) => filename.endsWith(`/src/features/${owner}`)))
          context.report({
            node,
            messageId: 'ownedTable',
            data: { table, owners: writers.map((owner) => `src/features/${owner}`).join(', ') },
          });
        if (!table || !owners[table]) return;
        let writes = properties(node.arguments[0]);
        if (operation === 'onConflictDoUpdate')
          writes = writes
            .filter((property) => key(property.key) === 'set')
            .flatMap((property) => properties(property.value));
        for (const property of writes) {
          const column = key(property.key);
          const owner = owners[table][column];
          if (operation === 'values' && insertDefaults.has(`${table}.${column}`)) continue;
          if (owner && !filename.endsWith(`/src/features/${owner}`))
            context.report({ node: property, messageId: 'owned', data: { table, column, owner } });
        }
      },
    };
  },
};

export default rule;
