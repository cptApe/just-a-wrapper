import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { owners } from '../../eslint-rules/no-machine-status-write.mjs';

// Machine name (first argument of defineStateMachine) to what it persists. Column lists need an
// owner in the rule; 'client' machines live in memory and 'json' machines in a payload.
const persists = {
  account: ['user.accountStatus'],
  'automatic top-up': ['autoTopupAttempt.status'],
  'browser candidate': ['browserCandidate.status'],
  'chat connection': 'client',
  connection: ['integration.status'],
  'credit grant': ['creditGrant.status'],
  invitation: ['invitation.status'],
  'local send': 'client',
  'manual top-up': ['manualTopupAttempt.status'],
  'member cleanup': ['integrationCleanup.status'],
  'member vault': ['workspaceMember.vaultStatus'],
  'notification email': ['notification.emailStatus'],
  'relay connection': 'client',
  session: ['session.status'],
  'session send': ['sessionSend.status'],
  'shared connection': ['sharedIntegration.status'],
  skill: ['skill.status'],
  task: ['task.status'],
  'task browser': ['session.browserbaseSessionStatus'],
  'task provider sync': ['task.providerSync'],
  'team visibility': ['session.visibility'],
  'tool decision': ['pendingConfirmation.status'],
  'tool delivery': ['customToolDispatch.status'],
  trash: ['file.deletedAt', 'folder.deletedAt'],
  'trigger delivery': 'json',
  'usage settlement': ['usageEvent.settlementStatus'],
  workspace: ['workspace.lifecycleStatus'],
  'workspace budget sync': ['workspace.budgetSyncStatus'],
  'workspace provisioning': ['workspaceMember.provisioningStatus'],
};

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// Skips the generic arguments after defineStateMachine, then reads the name literal.
function machineNames(text) {
  const names = [];
  for (const match of text.matchAll(/defineStateMachine\b/g)) {
    let i = match.index + match[0].length;
    while (/\s/.test(text[i])) i += 1;
    if (text[i] === '<') {
      let depth = 0;
      do {
        if (text[i] === '<') depth += 1;
        else if (text[i] === '>') depth -= 1;
        i += 1;
      } while (depth > 0 && i < text.length);
      while (/\s/.test(text[i])) i += 1;
    }
    if (text[i] !== '(') continue;
    i += 1;
    while (/\s/.test(text[i])) i += 1;
    const literal = /^(['"])([^'"]+)\1/.exec(text.slice(i));
    if (literal) names.push(literal[2]);
  }
  return names;
}

test('every state machine declares what it persists and every persisted column has an owner', () => {
  const found = new Set();
  for (const path of sourceFiles('src')) {
    if (path.endsWith('src/lib/state-machine.ts')) continue;
    for (const name of machineNames(readFileSync(path, 'utf8'))) found.add(name);
  }
  assert.ok(found.size > 20, 'machine discovery found too few machines');
  for (const name of found) {
    assert.ok(name in persists, `machine "${name}" is missing from the persists map in this test`);
    if (typeof persists[name] === 'string') continue;
    for (const target of persists[name]) {
      const [table, column] = target.split('.');
      assert.ok(owners[table]?.[column], `${target} (machine "${name}") has no owner in the rule`);
    }
  }
  for (const name of Object.keys(persists))
    assert.ok(found.has(name), `declared machine "${name}" no longer exists`);
});
