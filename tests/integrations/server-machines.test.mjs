// Connection, sharing, vault and cleanup rows move only along their declared steps, so a stale
// worker or a late provider answer cannot reopen a disconnected or removed row.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectionMachine } from '../../src/features/integrations/lib/connection-machine.ts';
import { memberCleanupMachine } from '../../src/features/integrations/lib/member-cleanup-machine.ts';
import { sharedConnectionMachine } from '../../src/features/integrations/lib/shared-connection-machine.ts';
import { vaultMachine } from '../../src/features/integrations/lib/vault-machine.ts';

for (const [name, machine, allowed] of [
  [
    'connection',
    connectionMachine,
    [
      'disconnected:disconnected',
      'connected:connected',
      'disconnecting:disconnecting',
      'disconnected:connected',
      'disconnected:disconnecting',
      'connected:disconnected',
      'connected:disconnecting',
      'disconnecting:disconnected',
    ],
  ],
  ['cleanup', memberCleanupMachine, ['pending:working', 'working:working', 'working:pending']],
  [
    'shared connection',
    sharedConnectionMachine,
    [
      'pending:pending',
      'pending:active',
      'pending:removing',
      'active:removing',
      'removing:removing',
    ],
  ],
  [
    'vault',
    vaultMachine,
    [
      'unprovisioned:provisioning',
      'provisioned:provisioning',
      'provisioning:provisioning',
      'provisioning:unprovisioned',
      'provisioning:provisioned',
    ],
  ],
]) {
  test(`a ${name} row moves only along its allowed steps`, () => {
    for (const from of machine.states)
      for (const to of machine.states)
        assert.equal(machine.can(from, to), allowed.includes(`${from}:${to}`), `${from} -> ${to}`);
  });
}
