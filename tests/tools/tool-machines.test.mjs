/** Every status move a tool call, an approval or a browser may make. A move not listed is
 * refused, so a delivered result or a closed browser can never be reopened by a replay. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserCandidateMachine } from '../../src/features/tools/lib/browser-candidate-machine.ts';
import { browserMachine } from '../../src/features/tools/lib/browser-machine.ts';
import {
  confirmationMachine,
  toolDeliveryMachine,
} from '../../src/features/tools/lib/tool-delivery-machine.ts';

const MACHINES = [
  [
    'tool delivery',
    toolDeliveryMachine,
    [
      'awaiting_decision:claimed',
      'awaiting_decision:ready',
      'claimed:executing',
      'claimed:ready',
      'executing:ready',
      'ready:delivering',
      'delivering:ready',
      'delivering:delivered',
      'delivering:abandoned',
      'delivered:completed',
    ],
  ],
  ['approval', confirmationMachine, ['pending:approved', 'pending:denied']],
  [
    'browser',
    browserMachine,
    [
      'active:user',
      'active:acting',
      'active:closing',
      'active:ended',
      'user:active',
      'user:closing',
      'user:ended',
      'acting:user',
      'acting:active',
      'acting:closing',
      'acting:ended',
      'closing:closed',
      'closing:ended',
    ],
  ],
  ['browser candidate', browserCandidateMachine, ['creating:created']],
];

for (const [label, machine, moves] of MACHINES) {
  test(`a ${label} moves only along its allowed steps`, () => {
    for (const from of machine.states) {
      for (const to of machine.states) {
        assert.equal(machine.can(from, to), moves.includes(`${from}:${to}`), `${from} to ${to}`);
      }
    }
  });
}
